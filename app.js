// app.js - BEL AGRÍCOLA (Versão Completa)

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
    inputCod: document.getElementById('input-cod'),   // Novo campo: Código
    inputName: document.getElementById('input-name'),
    inputOwner: document.getElementById('input-owner'),
    inputShp: document.getElementById('input-shp'),
    btnOpenSave: document.getElementById('btn-open-save'),
    
    // Listagem
    farmList: document.getElementById('farm-list'),
    
    // Modal (Janela Flutuante)
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

// 8. EVENTOS DE DESENHO MANUAL
// (Caso o usuário desenhe no mapa em vez de importar arquivo)
map.on('pm:create', (e) => {
    const layer = e.layer;
    currentLayerGroup.addLayer(layer);
    
    const geo = layer.toGeoJSON();
    const uniqueId = L.stamp(layer);
    
    // Define propriedades padrão
    geo.properties.tempId = uniqueId;
    geo.properties.talhao = `T-${currentFeaturesData.length + 1}`; // Nome sugerido

    // Salva no array de dados
    currentFeaturesData.push({
        layerId: uniqueId,
        feature: geo,
        layerInstance: layer
    });

    // Listener para atualizar dados se o usuário editar o desenho
    layer.on('pm:edit', () => updateFeatureData(layer));
});

// Atualiza o GeoJSON na memória quando o desenho é editado no mapa
function updateFeatureData(layer) {
    const id = L.stamp(layer);
    const index = currentFeaturesData.findIndex(f => f.layerId === id);
    if (index !== -1) {
        currentFeaturesData[index].feature = layer.toGeoJSON();
        currentFeaturesData[index].feature.properties.tempId = id;
        // Mantém o nome do talhão que já estava
        const oldName = currentFeaturesData[index].feature.properties.talhao;
        if (oldName) currentFeaturesData[index].feature.properties.talhao = oldName;
    }
}

// 9. FUNÇÃO DE REPROJEÇÃO (UTM -> LAT/LON)
function reprojectFeature(feature) {
    // Função recursiva para percorrer coordenadas profundas (ex: MultiPolygon)
    const transformCoords = (coords) => {
        // Se for par de coordenadas [x, y]
        if (typeof coords[0] === 'number') {
            const x = coords[0];
            const y = coords[1];
            
            // Lógica de detecção: Se X > 180, provavelmente é UTM (metros)
            if (Math.abs(x) > 180 || Math.abs(y) > 90) {
                try {
                    // Converte EPSG:32724 (UTM 24S) para EPSG:4326 (LatLon)
                    return proj4("EPSG:32724", "EPSG:4326", [x, y]);
                } catch (e) {
                    console.warn("Erro na conversão de ponto", e);
                    return coords;
                }
            }
            return coords; // Já está em LatLon
        }
        return coords.map(transformCoords);
    };

    // Clona e transforma
    const newFeature = JSON.parse(JSON.stringify(feature));
    newFeature.geometry.coordinates = transformCoords(newFeature.geometry.coordinates);
    return newFeature;
}

// 10. IMPORTAÇÃO DE ARQUIVO (SHP ou ZIP)
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
            // Arquivo .shp solto
            const geometries = shp.parseShp(arrayBuffer);
            geojson = { 
                type: "FeatureCollection", 
                features: geometries.map(g => ({ type: "Feature", properties: {}, geometry: g })) 
            };
        } else {
            // Arquivo .zip
            geojson = await shp(arrayBuffer);
        }

        // Normaliza para garantir que temos um array de features
        let featuresArray = [];
        if (Array.isArray(geojson)) { 
            // Zip pode conter múltiplos shapefiles
            geojson.forEach(g => featuresArray.push(...g.features));
        } else if (geojson.type === 'FeatureCollection') {
            featuresArray = geojson.features;
        } else {
            featuresArray = [geojson]; // Feature única
        }

        let count = 0;
        featuresArray.forEach((f, index) => {
            if (!f.geometry) return;

            // 1. Reprojetar
            const finalFeature = reprojectFeature(f);
            
            // 2. Criar Camada Leaflet
            const layer = L.geoJSON(finalFeature, {
                style: { color: '#ffff00', weight: 2, fillOpacity: 0.2 } // Amarelo para novos
            }).getLayers()[0]; // Extrai a layer interna

            if (!layer) return;

            const layerId = L.stamp(layer);
            
            // 3. Tentar adivinhar nome do talhão
            let talhaoName = finalFeature.properties.Name || 
                             finalFeature.properties.NOME || 
                             finalFeature.properties.TALHAO || 
                             `Talhão ${index + 1}`;
            
            finalFeature.properties.talhao = talhaoName;
            finalFeature.properties.tempId = layerId;

            // 4. Adicionar ao mapa e aos dados
            currentLayerGroup.addLayer(layer);
            currentFeaturesData.push({
                layerId: layerId,
                feature: finalFeature,
                layerInstance: layer
            });
            
            // Efeito visual ao passar mouse
            layer.on('mouseover', () => layer.setStyle({ weight: 4, fillOpacity: 0.5 }));
            layer.on('mouseout', () => layer.setStyle({ weight: 2, fillOpacity: 0.2 }));
            
            count++;
        });

        if (count > 0) {
            map.fitBounds(currentLayerGroup.getBounds());
            showToast(`${count} talhões/polígonos detectados!`, 'success');
        } else {
            showToast('Nenhum polígono válido encontrado.', 'error');
        }
        
        // Tenta preencher nome da fazenda se vier no shapefile
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

// 11. SISTEMA DE MODAL (Janela de Edição/Visualização)

function openModal(mode) {
    els.modalOverlay.classList.remove('hidden');
    els.tableBody.innerHTML = '';
    els.modalFooter.innerHTML = '';
    let totalArea = 0;

    if (mode === 'edit') {
        // --- MODO EDIÇÃO (Antes de Salvar) ---
        els.modalTitle.textContent = 'Revisão e Cadastro';
        isViewMode = false;

        currentFeaturesData.forEach((item) => {
            const areaHa = (turf.area(item.feature) / 10000);
            totalArea += areaHa;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <input type="text" value="${item.feature.properties.talhao}" data-id="${item.layerId}" class="input-talhao" placeholder="Nome do Talhão">
                </td>
                <td>${areaHa.toFixed(2)} ha</td>
                <td>
                    <button class="btn-icon" onclick="zoomToLayer(${item.layerId})">
                        <i class="fa fa-eye"></i>
                    </button>
                </td>
            `;
            
            // Highlight ao passar mouse na tabela
            tr.addEventListener('mouseenter', () => item.layerInstance.setStyle({ color: '#00ffcc', weight: 4 }));
            tr.addEventListener('mouseleave', () => item.layerInstance.setStyle({ color: '#ffff00', weight: 2 }));
            
            els.tableBody.appendChild(tr);
        });

        // Botão de Salvar no final do modal
        const btnSave = document.createElement('button');
        btnSave.className = 'primary';
        btnSave.innerHTML = '<i class="fa fa-save"></i> Confirmar Cadastro';
        btnSave.onclick = saveToDatabase;
        els.modalFooter.appendChild(btnSave);

    } else if (mode === 'view') {
        // --- MODO VISUALIZAÇÃO (Apenas Leitura) ---
        els.modalTitle.textContent = 'Detalhes da Fazenda';
        isViewMode = true;

        currentFeaturesData.forEach(item => {
            const areaHa = (turf.area(item.feature) / 10000);
            totalArea += areaHa;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${item.feature.properties.talhao || 'Sem nome'}</strong></td>
                <td>${areaHa.toFixed(2)} ha</td>
                <td>-</td>
            `;
            els.tableBody.appendChild(tr);
        });

        // Botão Fechar
        const btnClose = document.createElement('button');
        btnClose.textContent = 'Fechar';
        btnClose.className = 'btn-secondary';
        btnClose.onclick = closeModal;
        els.modalFooter.appendChild(btnClose);
    }

    // Atualiza resumo total
    els.modalSummary.innerHTML = `ÁREA TOTAL: ${totalArea.toFixed(2)} Hectares`;
}

function closeModal() {
    els.modalOverlay.classList.add('hidden');
}
els.btnCloseModal.addEventListener('click', closeModal);

// Botão "Revisar & Salvar" da Sidebar
els.btnOpenSave.addEventListener('click', () => {
    // Validações
    const cod = els.inputCod.value.trim();
    const name = els.inputName.value.trim();
    const owner = els.inputOwner.value.trim();

    if (!cod) return showToast('O Código da Fazenda é obrigatório.', 'error');
    if (!name) return showToast('O Nome da Fazenda é obrigatório.', 'error');
    if (!owner) return showToast('O Proprietário é obrigatório.', 'error');
    
    if (currentFeaturesData.length === 0) return showToast('Nenhum talhão desenhado ou importado.', 'error');

    openModal('edit');
});

// Helper global para o botão de olho na tabela
window.zoomToLayer = function(id) {
    const item = currentFeaturesData.find(f => f.layerId === id);
    if (item) map.fitBounds(item.layerInstance.getBounds());
};

// 12. SALVAR NO BANCO DE DADOS (Supabase)
async function saveToDatabase() {
    const cod = els.inputCod.value.trim();
    const name = els.inputName.value.trim();
    const owner = els.inputOwner.value.trim();
    
    // 1. Atualiza nomes dos talhões com o que foi digitado na tabela
    const inputs = document.querySelectorAll('.input-talhao');
    inputs.forEach(input => {
        const id = parseInt(input.dataset.id);
        const item = currentFeaturesData.find(f => f.layerId === id);
        if (item) {
            item.feature.properties.talhao = input.value;
        }
    });

    // 2. Prepara FeatureCollection GeoJSON
    const finalFeatures = currentFeaturesData.map(item => item.feature);
    const featureCollection = {
        type: "FeatureCollection",
        features: finalFeatures
    };

    // 3. Calcula área total
    const totalArea = (turf.area(featureCollection) / 10000);

    // 4. Payload para o RPC
    const payload = {
        p_cod_fazenda: cod,
        p_name: name,
        p_owner: owner,
        p_talhao: 'Múltiplos', // Campo legado, salvamos string fixa
        p_area_ha: totalArea,
        p_geojson: featureCollection // O JSON inteiro vai aqui
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
        
        // Recarrega lista
        loadFarms(); 

    } catch (err) {
        console.error(err);
        showToast('Erro ao salvar: ' + (err.message || err.details), 'error');
    }
}

// 13. CARREGAR E LISTAR FAZENDAS
async function loadFarms() {
    els.farmList.innerHTML = 'Carregando...';
    try {
        const { data, error } = await sb.rpc('get_farms');
        if (error) throw error;

        els.farmList.innerHTML = '';
        if (!data || data.length === 0) {
            els.farmList.innerHTML = '<div style="padding:10px; text-align:center;">Nenhum registro encontrado.</div>';
            return;
        }

        data.forEach(farm => {
            // Conta quantos talhões tem dentro do GeoJSON
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
                <button class="btn-icon" title="Ver Detalhes">
                    <i class="fa-solid fa-list"></i>
                </button>
            `;
            
            // Click: Ver no Mapa
            item.querySelector('button').addEventListener('click', () => viewFarmOnMap(farm));
            
            els.farmList.appendChild(item);
        });
    } catch (err) {
        console.error(err);
        els.farmList.innerHTML = 'Erro ao carregar lista.';
    }
}

// 14. VISUALIZAR FAZENDA (Modo View)
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
        // Cria layer para visualização (cor Ciano)
        const layer = L.geoJSON(f, {
            style: { color: '#00ffcc', weight: 2, fillOpacity: 0.3 }
        }).getLayers()[0];

        if (layer) {
            currentLayerGroup.addLayer(layer);
            
            // Adiciona aos dados (sem layerId pois não vamos editar)
            currentFeaturesData.push({
                feature: f,
                layerInstance: layer,
                layerId: null
            });

            layer.bindPopup(`
                <strong>Talhão: ${f.properties.talhao || '-'}</strong><br>
                Area: ${(turf.area(f)/10000).toFixed(2)} ha
            `);
        }
    });

    // Ajusta zoom
    const bounds = currentLayerGroup.getBounds();
    if (bounds.isValid()) {
        map.fitBounds(bounds, { maxZoom: 17 });
    }

    // Abre modal com a tabela
    openModal('view');
}

// 15. UTILITÁRIO: TOAST NOTIFICATION
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