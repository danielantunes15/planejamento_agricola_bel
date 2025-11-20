// app.js - BEL AGRÍCOLA (Versão Final com Edição e Rótulos Limpos)

// 1. VERIFICAÇÃO
if (typeof APP_CONFIG === 'undefined') {
    console.error('ERRO CRÍTICO: config.js ausente.');
    alert('Erro: config.js não encontrado.');
}

const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

if (typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:32724", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs");
}

// 2. ELEMENTOS DOM
const els = {
    inputCod: document.getElementById('input-cod'),
    inputName: document.getElementById('input-name'),
    inputOwner: document.getElementById('input-owner'),
    inputShp: document.getElementById('input-shp'),
    btnOpenSave: document.getElementById('btn-open-save'), // Botão da Sidebar
    farmList: document.getElementById('farm-list'),
    // Modal
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    modalSummary: document.getElementById('modal-summary'),
    tableBody: document.getElementById('talhoes-tbody'),
    modalFooter: document.getElementById('modal-footer-actions')
};

// 3. ESTADO GLOBAL
let currentLayerGroup = L.featureGroup(); 
let currentFeaturesData = []; 
let editingFarmId = null; // SE diferente de null, estamos editando uma fazenda existente

// 4. MAPA
const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google Maps'
});
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
});

const map = L.map('map', {
    center: [-12.97, -38.5],
    zoom: 6,
    layers: [googleSat]
});

L.control.layers({ "Google Satélite": googleSat, "Mapa de Estradas": osm }).addTo(map);
currentLayerGroup.addTo(map);

// Ferramentas de Desenho
map.pm.addControls({
    position: 'topleft',
    drawCircle: false, drawCircleMarker: false, drawMarker: false, drawPolyline: false,
    drawRectangle: true, drawPolygon: true, editMode: true, dragMode: false, cutPolygon: false, removalMode: true
});
map.pm.setLang('pt_br');


// --- 5. LÓGICA DE CAMADAS E RÓTULOS ---

function createLayerFromFeature(feature, isReadOnly) {
    if (!feature.properties) feature.properties = {};
    
    // Define área: usa a manual se tiver, senão calcula
    const calcArea = (turf.area(feature) / 10000);
    let displayArea = feature.properties.area_manual ? parseFloat(feature.properties.area_manual) : calcArea;
    
    // Limpeza do nome do talhão para o rótulo (Remove "Talhão " se existir)
    let rawName = feature.properties.talhao || '';
    let labelName = rawName.replace(/Talhão\s*|T-/yi, '').trim(); 
    if(!labelName) labelName = "?";

    // Cria a camada
    const layer = L.geoJSON(feature, {
        style: { 
            // Se estiver salvando (readOnly), cor Ciano. Se editando, Amarelo.
            color: isReadOnly ? '#00ffcc' : '#ffff00', 
            weight: isReadOnly ? 2 : 3, 
            fillOpacity: 0.2 
        }
    }).getLayers()[0];

    if (!layer) return null;
    
    const layerId = L.stamp(layer);
    feature.properties.tempId = layerId;

    // CONTEÚDO DO RÓTULO (HTML)
    // Mostra apenas Número e Área
    const labelContent = `
        <div style="line-height: 1.1;">
            <span style="font-size: 14px;">${labelName}</span><br>
            <span style="font-size: 11px;">${displayArea.toFixed(2)} ha</span>
        </div>
    `;

    // CONFIGURAÇÃO DO RÓTULO (TOOLTIP)
    // permanent: true faz aparecer sempre
    layer.bindTooltip(labelContent, {
        permanent: true,      
        direction: 'center',  
        className: 'talhao-label',
        interactive: true // Permite clicar através do rótulo se necessário
    });

    // EVENTOS
    if (!isReadOnly) {
        // MODO EDIÇÃO: CLIQUE ABRE POPUP PARA ALTERAR NÚMERO/ÁREA
        const popupContent = document.createElement('div');
        popupContent.className = 'edit-popup-form';
        popupContent.innerHTML = `
            <label><strong>Editar Dados</strong></label>
            <label>Número do Talhão:</label>
            <input type="text" id="edit-name-${layerId}" value="${labelName}" style="width: 100%; margin-bottom: 5px; font-size:16px; font-weight:bold;">
            
            <label>Área (ha):</label>
            <input type="number" step="0.01" id="edit-area-${layerId}" value="${displayArea.toFixed(2)}" style="width: 100%; margin-bottom: 8px;">
            
            <button id="btn-save-${layerId}" style="width: 100%; background: #10b981; color: white; border:0; padding:8px; border-radius:4px; cursor:pointer;">✔ Salvar</button>
        `;

        layer.bindPopup(popupContent, { minWidth: 180 });

        layer.on('popupopen', () => {
            const btn = document.getElementById(`btn-save-${layerId}`);
            const inputName = document.getElementById(`edit-name-${layerId}`);
            const inputArea = document.getElementById(`edit-area-${layerId}`);

            if(btn) {
                btn.onclick = () => {
                    const item = currentFeaturesData.find(f => f.layerId === layerId);
                    if (item) {
                        item.feature.properties.talhao = inputName.value; // Salva o numero
                        item.feature.properties.area_manual = parseFloat(inputArea.value);
                        
                        // Atualiza o rótulo visualmente na hora
                        const newLabel = `
                            <div style="line-height: 1.1;">
                                <span style="font-size: 14px;">${inputName.value}</span><br>
                                <span style="font-size: 11px;">${parseFloat(inputArea.value).toFixed(2)} ha</span>
                            </div>
                        `;
                        layer.setTooltipContent(newLabel);
                        
                        showToast('Dados atualizados!', 'success');
                        layer.closePopup();
                    }
                };
            }
        });
        
        // Efeito Hover
        layer.on('mouseover', () => layer.setStyle({ weight: 5, fillOpacity: 0.5 }));
        layer.on('mouseout', () => layer.setStyle({ weight: 3, fillOpacity: 0.2 }));
    } else {
        // MODO LEITURA: Só mostra um popup informativo simples
        layer.bindPopup(`
            <div style="text-align:center">
                <strong>Talhão ${labelName}</strong><br>
                ${displayArea.toFixed(2)} ha
            </div>
        `);
    }

    return { layer, feature, layerId };
}


// 6. EVENTOS DE DESENHO MANUAL
map.on('pm:create', (e) => {
    const layer = e.layer;
    const geo = layer.toGeoJSON();
    
    // Nome padrão (Apenas número)
    geo.properties.talhao = `${currentFeaturesData.length + 1}`;
    
    map.removeLayer(layer);

    const result = createLayerFromFeature(geo, false); // false = editável
    if (result) {
        currentLayerGroup.addLayer(result.layer);
        currentFeaturesData.push({
            layerId: result.layerId,
            feature: result.feature,
            layerInstance: result.layer
        });
        
        // Atualiza geometria ao arrastar vértices
        result.layer.on('pm:edit', () => updateFeatureData(result.layer));
    }
});

function updateFeatureData(layer) {
    const id = L.stamp(layer);
    const index = currentFeaturesData.findIndex(f => f.layerId === id);
    if (index !== -1) {
        const props = currentFeaturesData[index].feature.properties;
        const newGeo = layer.toGeoJSON();
        newGeo.properties = props; 
        currentFeaturesData[index].feature = newGeo;
    }
}

function reprojectFeature(feature) {
    const transformCoords = (coords) => {
        if (typeof coords[0] === 'number') {
            const x = coords[0], y = coords[1];
            if (Math.abs(x) > 180 || Math.abs(y) > 90) {
                try { return proj4("EPSG:32724", "EPSG:4326", [x, y]); } catch(e){ return coords; }
            }
            return coords; 
        }
        return coords.map(transformCoords);
    };
    const newFeature = JSON.parse(JSON.stringify(feature));
    newFeature.geometry.coordinates = transformCoords(newFeature.geometry.coordinates);
    return newFeature;
}


// 7. IMPORTAÇÃO
els.inputShp.addEventListener('change', async (ev) => {
    if (typeof shp === 'undefined') return alert('Biblioteca SHP não carregou.');
    const file = ev.target.files[0];
    if (!file) return;

    showToast('Processando...', 'info');
    
    // Se não estiver editando, limpa. Se estiver, pode adicionar mais (opcional, aqui limpa pra evitar confusão)
    if (!editingFarmId) {
        currentLayerGroup.clearLayers();
        currentFeaturesData = [];
    }

    try {
        const arrayBuffer = await file.arrayBuffer();
        let geojson;

        if (file.name.toLowerCase().endsWith('.shp')) {
            const geometries = shp.parseShp(arrayBuffer);
            geojson = { type: "FeatureCollection", features: geometries.map(g => ({ type: "Feature", properties: {}, geometry: g })) };
        } else {
            geojson = await shp(arrayBuffer);
        }

        let featuresArray = [];
        if (Array.isArray(geojson)) geojson.forEach(g => featuresArray.push(...g.features));
        else if (geojson.type === 'FeatureCollection') featuresArray = geojson.features;
        else featuresArray = [geojson];

        let count = 0;
        featuresArray.forEach((f, index) => {
            if (!f.geometry) return;
            const finalFeature = reprojectFeature(f);
            
            // Tenta pegar só o número
            let rawName = finalFeature.properties.Name || finalFeature.properties.TALHAO || `${index + 1}`;
            finalFeature.properties.talhao = rawName.toString().replace(/Talhão\s*|T-/yi, '').trim();

            const result = createLayerFromFeature(finalFeature, false); // Editável
            
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
            showToast(`${count} talhões importados.`, 'success');
        }
        ev.target.value = ''; 

    } catch (err) {
        console.error(err);
        showToast('Erro: ' + err.message, 'error');
    }
});


// 8. MODAL DE REVISÃO FINAL
function openModal() {
    els.modalOverlay.classList.remove('hidden');
    els.tableBody.innerHTML = '';
    els.modalFooter.innerHTML = '';
    let totalArea = 0;

    els.modalTitle.textContent = editingFarmId ? 'Editar Fazenda Existente' : 'Cadastrar Nova Fazenda';

    currentFeaturesData.forEach((item) => {
        let areaHa = item.feature.properties.area_manual 
            ? parseFloat(item.feature.properties.area_manual) 
            : (turf.area(item.feature) / 10000);
        
        totalArea += areaHa;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" value="${item.feature.properties.talhao}" data-id="${item.layerId}" class="input-talhao"></td>
            <td><input type="number" step="0.01" value="${areaHa.toFixed(2)}" data-id="${item.layerId}" class="input-area" style="width:80px"> ha</td>
            <td><button class="btn-icon" onclick="zoomToLayer(${item.layerId})"><i class="fa fa-eye"></i></button></td>
        `;
        
        tr.addEventListener('mouseenter', () => item.layerInstance.setStyle({ color: '#00ffcc', weight: 4 }));
        tr.addEventListener('mouseleave', () => item.layerInstance.setStyle({ color: '#ffff00', weight: 2 }));
        els.tableBody.appendChild(tr);
    });

    const btnSave = document.createElement('button');
    btnSave.className = 'primary';
    btnSave.innerHTML = editingFarmId ? '<i class="fa fa-save"></i> Atualizar Fazenda' : '<i class="fa fa-save"></i> Confirmar Cadastro';
    btnSave.onclick = saveToDatabase;
    els.modalFooter.appendChild(btnSave);

    els.modalSummary.innerHTML = `ÁREA TOTAL: ${totalArea.toFixed(2)} Hectares`;
}

function closeModal() { els.modalOverlay.classList.add('hidden'); }
els.btnCloseModal.addEventListener('click', closeModal);

// Botão Sidebar (Revisar e Salvar)
els.btnOpenSave.addEventListener('click', () => {
    const cod = els.inputCod.value.trim();
    const name = els.inputName.value.trim();
    const owner = els.inputOwner.value.trim();

    if (!cod || !name || !owner) return showToast('Preencha todos os campos (Cód, Nome, Dono).', 'error');
    if (currentFeaturesData.length === 0) return showToast('Mapa vazio.', 'error');
    openModal();
});

window.zoomToLayer = function(id) {
    const item = currentFeaturesData.find(f => f.layerId === id);
    if (item) map.fitBounds(item.layerInstance.getBounds());
};


// 9. SALVAR OU ATUALIZAR
async function saveToDatabase() {
    const cod = els.inputCod.value.trim();
    const name = els.inputName.value.trim();
    const owner = els.inputOwner.value.trim();
    
    // Sincroniza tabela do modal com memória
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
    const featureCollection = { type: "FeatureCollection", features: finalFeatures };

    showToast('Enviando...', 'info');
    closeModal();

    try {
        let error;
        if (editingFarmId) {
            // ATUALIZAR (UPDATE)
            const payload = {
                p_id: editingFarmId,
                p_cod_fazenda: cod,
                p_name: name,
                p_owner: owner,
                p_area_ha: totalArea,
                p_geojson: featureCollection
            };
            const res = await sb.rpc('update_farm', payload);
            error = res.error;
        } else {
            // CADASTRAR NOVO (INSERT)
            const payload = {
                p_cod_fazenda: cod,
                p_name: name,
                p_owner: owner,
                p_talhao: 'Multi',
                p_area_ha: totalArea,
                p_geojson: featureCollection
            };
            const res = await sb.rpc('insert_farm', payload);
            error = res.error;
        }

        if (error) throw error;

        showToast(editingFarmId ? 'Fazenda atualizada!' : 'Fazenda criada!', 'success');
        
        resetApp();
        loadFarms(); 

    } catch (err) {
        console.error(err);
        showToast('Erro: ' + (err.message || err.details), 'error');
    }
}

function resetApp() {
    els.inputCod.value = ''; 
    els.inputName.value = ''; 
    els.inputOwner.value = '';
    currentLayerGroup.clearLayers();
    currentFeaturesData = [];
    editingFarmId = null;
    els.btnOpenSave.innerHTML = '<i class="fa-solid fa-list-check"></i> Revisar & Salvar';
}


// 10. CARREGAR LISTA
async function loadFarms() {
    els.farmList.innerHTML = 'Carregando...';
    try {
        const { data, error } = await sb.rpc('get_farms');
        if (error) throw error;

        els.farmList.innerHTML = '';
        if (!data || data.length === 0) {
            els.farmList.innerHTML = '<div style="padding:10px; text-align:center;">Vazio.</div>';
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
                    <div class="farm-meta">${Number(farm.area_ha).toFixed(2)} ha • ${numTalhoes} T</div>
                </div>
                <div style="display:flex; gap:5px;">
                    <button class="btn-icon edit-btn" title="Editar Dados"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon view-btn" title="Ver no Mapa"><i class="fa-solid fa-map"></i></button>
                </div>
            `;
            
            // Botão EDITAR
            item.querySelector('.edit-btn').addEventListener('click', () => loadFarmForEditing(farm));
            
            // Botão VISUALIZAR
            item.querySelector('.view-btn').addEventListener('click', () => viewFarmOnMap(farm));
            
            els.farmList.appendChild(item);
        });
    } catch (err) {
        els.farmList.innerHTML = 'Erro.';
    }
}

// Função para carregar fazenda no MODO DE EDIÇÃO
function loadFarmForEditing(farm) {
    resetApp();
    editingFarmId = farm.id; // Ativa flag de edição

    // Preenche inputs
    els.inputCod.value = farm.cod_fazenda || '';
    els.inputName.value = farm.name;
    els.inputOwner.value = farm.owner || ''; // O RPC get_farms precisa retornar owner
    
    els.btnOpenSave.innerHTML = '<i class="fa-solid fa-save"></i> Atualizar Dados';

    showToast(`Editando: ${farm.name}`, 'info');

    // Carrega polígonos como editáveis
    if (farm.geojson) {
        let features = farm.geojson.type === 'FeatureCollection' ? farm.geojson.features : [farm.geojson];
        features.forEach(f => {
            const result = createLayerFromFeature(f, false); // false = Editável
            if (result) {
                currentLayerGroup.addLayer(result.layer);
                currentFeaturesData.push({
                    layerId: result.layerId,
                    feature: result.feature,
                    layerInstance: result.layer
                });
            }
        });
        map.fitBounds(currentLayerGroup.getBounds());
    }
}

// Função para MODO DE LEITURA
function viewFarmOnMap(farm) {
    // Não limpa inputs, só limpa o mapa para visualização
    currentLayerGroup.clearLayers();
    // currentFeaturesData não é usado para salvar aqui, mas é usado se quisermos abrir a tabela
    
    if (!farm.geojson) return showToast('Sem geometria.', 'error');

    let features = farm.geojson.type === 'FeatureCollection' ? farm.geojson.features : [farm.geojson];

    features.forEach(f => {
        const result = createLayerFromFeature(f, true); // true = Somente Leitura (Rótulos Permanentes)
        if (result) {
            currentLayerGroup.addLayer(result.layer);
        }
    });

    const bounds = currentLayerGroup.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds);
}

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = type === 'error' ? 'exclamation-circle' : 'check-circle';
    if(type==='info') icon = 'info-circle';
    toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// Nota: Precisamos atualizar get_farms para retornar 'owner' para a edição funcionar 100%
// Se não, o campo proprietário virá vazio ao clicar em editar.
loadFarms();