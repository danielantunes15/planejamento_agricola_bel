// app.js - BEL AGRÍCOLA (Versão Final Completa)

// 1. VERIFICAÇÃO DE CONFIGURAÇÃO
if (typeof APP_CONFIG === 'undefined') {
    console.error('ERRO CRÍTICO: Arquivo config.js não foi carregado.');
    alert('Erro de configuração: O arquivo config.js não foi encontrado. Verifique o console.');
}

// 2. INICIALIZAÇÃO DO SUPABASE
const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

// 3. DEFINIÇÃO DE PROJEÇÃO (UTM 24S -> WGS84)
// Necessário para converter coordenadas do QGIS para o Mapa Web
if (typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:32724", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs");
}

// 4. ELEMENTOS DO DOM
const els = {
    // Formulário
    inputCod: document.getElementById('input-cod'),
    inputName: document.getElementById('input-name'),
    inputOwner: document.getElementById('input-owner'),
    inputShp: document.getElementById('input-shp'),
    btnOpenSave: document.getElementById('btn-open-save'),
    
    // Listagem
    farmList: document.getElementById('farm-list'),
    
    // Modal (Janela Flutuante - para resumo final)
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    modalSummary: document.getElementById('modal-summary'),
    tableBody: document.getElementById('talhoes-tbody'),
    modalFooter: document.getElementById('modal-footer-actions')
};

// 5. VARIÁVEIS DE ESTADO GLOBAL
let currentLayerGroup = L.featureGroup(); // Grupo de camadas no mapa
let currentFeaturesData = [];             // Dados temporários dos talhões
let isViewMode = false;                   // Flag: estamos vendo ou editando?

// 6. CONFIGURAÇÃO DO MAPA E CAMADAS
// Camada Satélite do Google
const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '© Google Maps'
});

// Camada Estradas (OpenStreetMap)
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
});

// Inicializa Mapa (Foco Bahia)
const map = L.map('map', {
    center: [-12.97, -38.5],
    zoom: 6,
    layers: [googleSat] // Padrão: Satélite
});

// Controle de Camadas (Canto superior direito)
L.control.layers({ 
    "Google Satélite": googleSat, 
    "Mapa de Estradas": osm 
}).addTo(map);

// Adiciona o grupo de camadas de desenho ao mapa
currentLayerGroup.addTo(map);

// 7. CONFIGURAÇÃO DO GEOMAN (Ferramentas de Desenho)
map.pm.addControls({
    position: 'topleft',
    drawCircle: false,
    drawCircleMarker: false,
    drawMarker: false,
    drawPolyline: false,
    drawRectangle: true,
    drawPolygon: true,
    editMode: true,
    dragMode: false,
    cutPolygon: false,
    removalMode: true
});
map.pm.setLang('pt_br');


// --- 8. LÓGICA CENTRAL DE CRIAÇÃO DE LAYERS ---
// Esta função decide como o polígono se comporta (se tem rótulo fixo ou popup de edição)

function createLayerFromFeature(feature, isReadOnly) {
    // Garante propriedades básicas
    if (!feature.properties) feature.properties = {};
    
    // Calcula área (se não tiver manual, usa a calculada via Turf)
    const calcArea = (turf.area(feature) / 10000);
    // Se já tiver uma área salva manual (editada), usa ela. Senão, usa a calculada.
    let displayArea = feature.properties.area_manual ? parseFloat(feature.properties.area_manual) : calcArea;
    
    // Cria a camada Leaflet
    const layer = L.geoJSON(feature, {
        style: { 
            color: isReadOnly ? '#00ffcc' : '#ffff00', // Ciano (Salvo) vs Amarelo (Editando)
            weight: 2, 
            fillOpacity: 0.2 
        }
    }).getLayers()[0];

    if (!layer) return null;
    
    const layerId = L.stamp(layer);
    feature.properties.tempId = layerId; // Linka feature <-> layer

    // --- MODO LEITURA (VISUALIZAÇÃO) ---
    if (isReadOnly) {
        // Rótulo Permanente no Mapa (Nome + Área)
        const labelContent = `
            <div>
                ${feature.properties.talhao || '-'}<br>
                ${displayArea.toFixed(2)} ha
            </div>
        `;
        layer.bindTooltip(labelContent, {
            permanent: true,      // Fica sempre visível
            direction: 'center',  // No meio do polígono
            className: 'talhao-label' // Classe CSS para estilo (texto branco com borda)
        });

        // Popup simples ao clicar para detalhes extras
        layer.bindPopup(`
            <strong>Talhão: ${feature.properties.talhao}</strong><br>
            Área: ${displayArea.toFixed(2)} ha
        `);
    } 
    // --- MODO EDIÇÃO (CADASTRO) ---
    else {
        // Popup com Formulário de Edição
        const popupContent = document.createElement('div');
        popupContent.className = 'edit-popup-form';
        popupContent.innerHTML = `
            <label><strong>Editar Talhão</strong></label>
            <label>Nome/Número:</label>
            <input type="text" id="edit-name-${layerId}" value="${feature.properties.talhao || ''}" style="width: 100%; margin-bottom: 5px;">
            
            <label>Área (ha):</label>
            <input type="number" step="0.01" id="edit-area-${layerId}" value="${displayArea.toFixed(2)}" style="width: 100%; margin-bottom: 5px;">
            
            <button id="btn-save-${layerId}" style="width: 100%;">✔ Atualizar Dados</button>
        `;

        // Vincula o popup
        layer.bindPopup(popupContent);

        // Evento: Quando o popup abre, adicionamos o clique no botão salvar
        layer.on('popupopen', () => {
            const btn = document.getElementById(`btn-save-${layerId}`);
            const inputName = document.getElementById(`edit-name-${layerId}`);
            const inputArea = document.getElementById(`edit-area-${layerId}`);

            if(btn) {
                btn.onclick = () => {
                    // Atualiza os dados na memória
                    const item = currentFeaturesData.find(f => f.layerId === layerId);
                    if (item) {
                        item.feature.properties.talhao = inputName.value;
                        item.feature.properties.area_manual = parseFloat(inputArea.value); // Salva área manual
                        
                        showToast(`Talhão atualizado: ${inputName.value}`, 'success');
                        layer.closePopup();
                    }
                };
            }
        });

        // Efeitos de hover para saber qual está selecionando
        layer.on('mouseover', () => layer.setStyle({ weight: 4, fillOpacity: 0.5 }));
        layer.on('mouseout', () => layer.setStyle({ weight: 2, fillOpacity: 0.2 }));
    }

    return { layer, feature, layerId };
}


// 9. EVENTOS DE DESENHO MANUAL (Geoman)
map.on('pm:create', (e) => {
    const layer = e.layer;
    const geo = layer.toGeoJSON();
    
    // Define nome padrão
    geo.properties.talhao = `T-${currentFeaturesData.length + 1}`;
    
    // Remove a layer crua do Geoman e recria usando nossa função padronizada (com popup de edição)
    map.removeLayer(layer);

    const result = createLayerFromFeature(geo, false); // false = modo edição
    if (result) {
        currentLayerGroup.addLayer(result.layer);
        currentFeaturesData.push({
            layerId: result.layerId,
            feature: result.feature,
            layerInstance: result.layer
        });
        
        // Listener para atualizar geometria se o usuário arrastar os pontos
        result.layer.on('pm:edit', () => updateFeatureData(result.layer));
    }
});

function updateFeatureData(layer) {
    const id = L.stamp(layer);
    const index = currentFeaturesData.findIndex(f => f.layerId === id);
    if (index !== -1) {
        // Preserva propriedades (nome, area manual) e atualiza só a geometria
        const props = currentFeaturesData[index].feature.properties;
        const newGeo = layer.toGeoJSON();
        newGeo.properties = props; 
        currentFeaturesData[index].feature = newGeo;
    }
}


// 10. FUNÇÃO REPROJEÇÃO (UTM -> LAT/LON)
function reprojectFeature(feature) {
    const transformCoords = (coords) => {
        // Se for par de coordenadas [x, y]
        if (typeof coords[0] === 'number') {
            const x = coords[0];
            const y = coords[1];
            
            // Lógica simples: Se X > 180, provavelmente é UTM (metros)
            if (Math.abs(x) > 180 || Math.abs(y) > 90) {
                try {
                    // Converte EPSG:32724 (UTM 24S) para EPSG:4326 (LatLon)
                    return proj4("EPSG:32724", "EPSG:4326", [x, y]);
                } catch (e) {
                    console.warn("Erro conversão", e);
                    return coords;
                }
            }
            return coords; // Já está em LatLon
        }
        return coords.map(transformCoords);
    };

    const newFeature = JSON.parse(JSON.stringify(feature));
    newFeature.geometry.coordinates = transformCoords(newFeature.geometry.coordinates);
    return newFeature;
}


// 11. IMPORTAÇÃO DE ARQUIVO (SHP ou ZIP)
els.inputShp.addEventListener('change', async (ev) => {
    if (typeof shp === 'undefined') {
        alert('ERRO: Biblioteca shpjs não carregou. Verifique sua internet.');
        return;
    }
    
    const file = ev.target.files[0];
    if (!file) return;

    showToast('Lendo e processando arquivo...', 'info');
    
    // Limpa mapa atual
    currentLayerGroup.clearLayers();
    currentFeaturesData = [];

    try {
        const arrayBuffer = await file.arrayBuffer();
        let geojson;

        // Verifica extensão
        if (file.name.toLowerCase().endsWith('.shp')) {
            const geometries = shp.parseShp(arrayBuffer);
            geojson = { 
                type: "FeatureCollection", 
                features: geometries.map(g => ({ type: "Feature", properties: {}, geometry: g })) 
            };
        } else {
            geojson = await shp(arrayBuffer);
        }

        // Normaliza para garantir array
        let featuresArray = [];
        if (Array.isArray(geojson)) { 
            geojson.forEach(g => featuresArray.push(...g.features));
        } else if (geojson.type === 'FeatureCollection') {
            featuresArray = geojson.features;
        } else {
            featuresArray = [geojson];
        }

        let count = 0;
        featuresArray.forEach((f, index) => {
            if (!f.geometry) return;

            // 1. Reprojetar
            const finalFeature = reprojectFeature(f);
            
            // 2. Tentar adivinhar nome do talhão
            let talhaoName = finalFeature.properties.Name || 
                             finalFeature.properties.NOME || 
                             finalFeature.properties.TALHAO || 
                             `T-${index + 1}`;
            
            finalFeature.properties.talhao = talhaoName;

            // 3. CRIAR LAYER (MODO EDIÇÃO)
            const result = createLayerFromFeature(finalFeature, false); 
            
            if (result) {
                currentLayerGroup.addLayer(result.layer);
                currentFeaturesData.push({
                    layerId: result.layerId,
                    feature: result.feature,
                    layerInstance: result.layer
                });
                count++;
            }
        });

        if (count > 0) {
            map.fitBounds(currentLayerGroup.getBounds());
            showToast(`${count} talhões importados. Clique neles para editar.`, 'success');
        } else {
            showToast('Nenhum polígono válido encontrado.', 'error');
        }
        
        // Tenta preencher nome da fazenda
        if (featuresArray[0] && featuresArray[0].properties) {
             const p = featuresArray[0].properties;
             const possibleName = p.FAZENDA || p.FARM || p.PROPRIEDADE;
             if (possibleName) els.inputName.value = possibleName;
        }

        ev.target.value = ''; // Reseta input

    } catch (err) {
        console.error(err);
        showToast('Erro ao ler arquivo: ' + err.message, 'error');
    }
});


// 12. SISTEMA DE MODAL (Resumo Final)

function openModal(mode) {
    els.modalOverlay.classList.remove('hidden');
    els.tableBody.innerHTML = '';
    els.modalFooter.innerHTML = '';
    let totalArea = 0;

    if (mode === 'edit') {
        // --- MODO CADASTRO (Revisão Final) ---
        els.modalTitle.textContent = 'Revisão e Cadastro';
        isViewMode = false;

        currentFeaturesData.forEach((item) => {
            // Usa área manual se existir, senão calcula
            let areaHa = item.feature.properties.area_manual 
                ? parseFloat(item.feature.properties.area_manual) 
                : (turf.area(item.feature) / 10000);
            
            totalArea += areaHa;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <input type="text" value="${item.feature.properties.talhao}" data-id="${item.layerId}" class="input-talhao" placeholder="Nome">
                </td>
                <td>
                    <input type="number" step="0.01" value="${areaHa.toFixed(2)}" data-id="${item.layerId}" class="input-area" style="width:80px"> ha
                </td>
                <td>
                    <button class="btn-icon" onclick="zoomToLayer(${item.layerId})"><i class="fa fa-eye"></i></button>
                </td>
            `;
            
            // Highlight na tabela destaca no mapa
            tr.addEventListener('mouseenter', () => item.layerInstance.setStyle({ color: '#00ffcc', weight: 4 }));
            tr.addEventListener('mouseleave', () => item.layerInstance.setStyle({ color: '#ffff00', weight: 2 }));
            els.tableBody.appendChild(tr);
        });

        const btnSave = document.createElement('button');
        btnSave.className = 'primary';
        btnSave.innerHTML = '<i class="fa fa-save"></i> Confirmar Cadastro';
        btnSave.onclick = saveToDatabase;
        els.modalFooter.appendChild(btnSave);

    } else if (mode === 'view') {
        // --- MODO LEITURA (Tabela Simples) ---
        els.modalTitle.textContent = 'Detalhes da Fazenda';
        isViewMode = true;

        currentFeaturesData.forEach(item => {
            // Em modo leitura, sempre deve ter area_manual salva ou calculada
            let areaHa = item.feature.properties.area_manual 
                ? parseFloat(item.feature.properties.area_manual) 
                : (turf.area(item.feature) / 10000);
            
            totalArea += areaHa;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${item.feature.properties.talhao || '-'}</strong></td>
                <td>${areaHa.toFixed(2)} ha</td>
                <td>-</td>
            `;
            els.tableBody.appendChild(tr);
        });

        const btnClose = document.createElement('button');
        btnClose.textContent = 'Fechar';
        btnClose.className = 'btn-secondary';
        btnClose.onclick = closeModal;
        els.modalFooter.appendChild(btnClose);
    }

    // Resumo Total
    els.modalSummary.innerHTML = `ÁREA TOTAL: ${totalArea.toFixed(2)} Hectares`;
}

function closeModal() {
    els.modalOverlay.classList.add('hidden');
}
els.btnCloseModal.addEventListener('click', closeModal);

// Botão Principal da Sidebar
els.btnOpenSave.addEventListener('click', () => {
    const cod = els.inputCod.value.trim();
    const name = els.inputName.value.trim();
    const owner = els.inputOwner.value.trim();

    if (!cod) return showToast('Preencha o Código da Fazenda.', 'error');
    if (!name) return showToast('Preencha o Nome da Fazenda.', 'error');
    if (!owner) return showToast('Preencha o Proprietário.', 'error');
    
    if (currentFeaturesData.length === 0) return showToast('Nenhum talhão no mapa.', 'error');

    openModal('edit');
});

window.zoomToLayer = function(id) {
    const item = currentFeaturesData.find(f => f.layerId === id);
    if (item) map.fitBounds(item.layerInstance.getBounds());
};


// 13. SALVAR NO BANCO DE DADOS
async function saveToDatabase() {
    const cod = els.inputCod.value.trim();
    const name = els.inputName.value.trim();
    const owner = els.inputOwner.value.trim();
    
    // Sincroniza dados caso o usuário tenha mudado algo na tabela do modal
    const inputsName = document.querySelectorAll('.input-talhao');
    const inputsArea = document.querySelectorAll('.input-area');
    
    let totalArea = 0;

    inputsName.forEach((input, idx) => {
        const id = parseInt(input.dataset.id);
        const item = currentFeaturesData.find(f => f.layerId === id);
        if (item) {
            item.feature.properties.talhao = input.value;
            
            const areaVal = parseFloat(inputsArea[idx].value);
            item.feature.properties.area_manual = areaVal;
            totalArea += areaVal;
        }
    });

    const finalFeatures = currentFeaturesData.map(item => item.feature);
    const featureCollection = {
        type: "FeatureCollection",
        features: finalFeatures
    };

    const payload = {
        p_cod_fazenda: cod,
        p_name: name,
        p_owner: owner,
        p_talhao: 'Múltiplos', 
        p_area_ha: totalArea,
        p_geojson: featureCollection
    };

    showToast('Enviando dados...', 'info');
    closeModal();

    try {
        const { error } = await sb.rpc('insert_farm', payload);
        if (error) throw error;

        showToast('Fazenda cadastrada com sucesso!', 'success');
        
        // Limpa formulário
        els.inputCod.value = ''; 
        els.inputName.value = ''; 
        els.inputOwner.value = '';
        currentLayerGroup.clearLayers();
        currentFeaturesData = [];
        
        loadFarms(); // Atualiza lista

    } catch (err) {
        console.error(err);
        showToast('Erro ao salvar: ' + (err.message || err.details), 'error');
    }
}


// 14. CARREGAR E LISTAR FAZENDAS
async function loadFarms() {
    els.farmList.innerHTML = 'Carregando...';
    try {
        const { data, error } = await sb.rpc('get_farms');
        if (error) throw error;

        els.farmList.innerHTML = '';
        if (!data || data.length === 0) {
            els.farmList.innerHTML = '<div style="padding:10px; text-align:center;">Nenhuma fazenda cadastrada.</div>';
            return;
        }

        data.forEach(farm => {
            const numTalhoes = farm.geojson && farm.geojson.features ? farm.geojson.features.length : 1;

            const item = document.createElement('div');
            item.className = 'farm-item';
            item.innerHTML = `
                <div class="farm-info">
                    <div style="font-size:10px; color:#4ade80; font-weight:bold;">COD: ${farm.cod_fazenda || '?'}</div>
                    <strong>${farm.name}</strong>
                    <div class="farm-meta">
                        ${Number(farm.area_ha).toFixed(2)} ha • ${numTalhoes} talhões
                    </div>
                </div>
                <button class="btn-icon" title="Ver no Mapa">
                    <i class="fa-solid fa-map"></i>
                </button>
            `;
            
            // Clique para carregar no mapa
            item.querySelector('button').addEventListener('click', () => viewFarmOnMap(farm));
            
            els.farmList.appendChild(item);
        });
    } catch (err) {
        console.error(err);
        els.farmList.innerHTML = 'Erro ao carregar lista.';
    }
}


// 15. VISUALIZAR FAZENDA (Modo View)
function viewFarmOnMap(farm) {
    // Limpa mapa
    currentLayerGroup.clearLayers();
    currentFeaturesData = [];

    if (!farm.geojson) {
        return showToast('Erro: Fazenda sem geometria válida.', 'error');
    }

    // Normaliza features
    let features = farm.geojson.type === 'FeatureCollection' ? farm.geojson.features : [farm.geojson];

    features.forEach(f => {
        // MODO LEITURA (isReadOnly = true)
        // Isso ativa os rótulos permanentes no mapa
        const result = createLayerFromFeature(f, true);
        
        if (result) {
            currentLayerGroup.addLayer(result.layer);
            // Adiciona aos dados para eventual consulta na tabela
            currentFeaturesData.push({
                feature: f,
                layerInstance: result.layer,
                layerId: null
            });
        }
    });

    // Ajusta zoom
    const bounds = currentLayerGroup.getBounds();
    if (bounds.isValid()) {
        map.fitBounds(bounds, { maxZoom: 16 });
    }

    // Opcional: Você pode descomentar a linha abaixo se quiser que a tabela abra automaticamente
    // openModal('view'); 
}


// 16. UTILITÁRIO: TOAST NOTIFICATION
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'check-circle';
    if (type === 'error') icon = 'exclamation-circle';
    if (type === 'info') icon = 'info-circle';

    toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> ${msg}`;
    container.appendChild(toast);

    // Auto-remove
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// INICIALIZAÇÃO
loadFarms();