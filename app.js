// app.js - BEL AGRÍCOLA (Zoom Inteligente e Visual Limpo)

if (typeof APP_CONFIG === 'undefined') {
    console.error('ERRO CRÍTICO: config.js ausente.');
    alert('Erro: config.js não encontrado.');
}

const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

if (typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:32724", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs");
}

const els = {
    inputCod: document.getElementById('input-cod'),
    inputName: document.getElementById('input-name'),
    inputOwner: document.getElementById('input-owner'),
    inputShp: document.getElementById('input-shp'),
    btnOpenSave: document.getElementById('btn-open-save'),
    farmList: document.getElementById('farm-list'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    modalSummary: document.getElementById('modal-summary'),
    tableBody: document.getElementById('talhoes-tbody'),
    modalFooter: document.getElementById('modal-footer-actions')
};

let currentLayerGroup = L.featureGroup(); 
let currentFeaturesData = []; 
let editingFarmId = null;

// --- MAPA ---
const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 21, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '© Google Maps'
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

// --- CONTROLE DE ZOOM INTELIGENTE (NOVO) ---
// Verifica o zoom a cada movimento. 
// Se zoom < 14 (longe), esconde rótulos. Se zoom >= 14 (perto), mostra.
function checkZoomLevel() {
    const zoom = map.getZoom();
    const mapDiv = document.getElementById('map');
    
    if (zoom < 14) {
        mapDiv.classList.add('hide-labels');
    } else {
        mapDiv.classList.remove('hide-labels');
    }
}

// Ativa a verificação de zoom
map.on('zoomend', checkZoomLevel);
// Roda uma vez ao iniciar
checkZoomLevel();


// Geoman
map.pm.addControls({
    position: 'topleft',
    drawCircle: false, drawCircleMarker: false, drawMarker: false, drawPolyline: false,
    drawRectangle: true, drawPolygon: true, editMode: true, dragMode: false, cutPolygon: false, removalMode: true
});
map.pm.setLang('pt_br');


// --- LÓGICA DE LAYER E RÓTULOS ---
function createLayerFromFeature(feature, isReadOnly) {
    if (!feature.properties) feature.properties = {};
    
    const calcArea = (turf.area(feature) / 10000);
    let displayArea = feature.properties.area_manual ? parseFloat(feature.properties.area_manual) : calcArea;
    
    // Limpa o nome (Tira "Talhão", "T-", etc, deixa só o número/nome curto)
    let rawName = feature.properties.talhao || '';
    let labelName = rawName.replace(/Talhão\s*|Talhao\s*|T-/yi, '').trim(); 
    if(!labelName) labelName = "?";

    const layer = L.geoJSON(feature, {
        style: { 
            color: isReadOnly ? '#00ffcc' : '#ffff00', 
            weight: isReadOnly ? 2 : 3, 
            fillOpacity: 0.2 
        }
    }).getLayers()[0];

    if (!layer) return null;
    
    const layerId = L.stamp(layer);
    feature.properties.tempId = layerId;

    // --- DESIGN DO RÓTULO (HTML) ---
    // Visual mais limpo, número grande, area pequena
    const labelContent = `
        <div style="line-height: 1; text-align:center;">
            <span style="font-size: 16px; display:block; margin-bottom:2px;">${labelName}</span>
            <span style="font-size: 11px; font-weight:400; opacity:0.9;">${displayArea.toFixed(2)} ha</span>
        </div>
    `;

    // Adiciona o rótulo
    layer.bindTooltip(labelContent, {
        permanent: true,      
        direction: 'center',  
        className: 'talhao-label',
        interactive: true 
    });

    // --- MODOS ---
    if (!isReadOnly) {
        // MODO EDIÇÃO (POPUP)
        const popupContent = document.createElement('div');
        popupContent.className = 'edit-popup-form';
        popupContent.innerHTML = `
            <label><strong>Editar Dados</strong></label>
            <label>Número do Talhão:</label>
            <input type="text" id="edit-name-${layerId}" value="${labelName}">
            <label>Área (ha):</label>
            <input type="number" step="0.01" id="edit-area-${layerId}" value="${displayArea.toFixed(2)}">
            <button id="btn-save-${layerId}" style="background:#10b981;color:white;border:0;padding:6px;margin-top:5px;cursor:pointer">✔ Salvar</button>
        `;

        layer.bindPopup(popupContent, { minWidth: 150 });

        layer.on('popupopen', () => {
            const btn = document.getElementById(`btn-save-${layerId}`);
            const inputName = document.getElementById(`edit-name-${layerId}`);
            const inputArea = document.getElementById(`edit-area-${layerId}`);

            if(btn) {
                btn.onclick = () => {
                    const item = currentFeaturesData.find(f => f.layerId === layerId);
                    if (item) {
                        item.feature.properties.talhao = inputName.value;
                        item.feature.properties.area_manual = parseFloat(inputArea.value);
                        
                        // Atualiza rótulo instantaneamente
                        const newLabel = `
                            <div style="line-height: 1; text-align:center;">
                                <span style="font-size: 16px; display:block; margin-bottom:2px;">${inputName.value}</span>
                                <span style="font-size: 11px; font-weight:400; opacity:0.9;">${parseFloat(inputArea.value).toFixed(2)} ha</span>
                            </div>
                        `;
                        layer.setTooltipContent(newLabel);
                        showToast('Atualizado!', 'success');
                        layer.closePopup();
                    }
                };
            }
        });
        
        layer.on('mouseover', () => layer.setStyle({ weight: 4, fillOpacity: 0.4 }));
        layer.on('mouseout', () => layer.setStyle({ weight: 3, fillOpacity: 0.2 }));
    } else {
        // MODO LEITURA
        layer.bindPopup(`<strong>Talhão ${labelName}</strong><br>${displayArea.toFixed(2)} ha`);
        layer.on('mouseover', () => layer.setStyle({ weight: 4, fillOpacity: 0.4 }));
        layer.on('mouseout', () => layer.setStyle({ weight: 2, fillOpacity: 0.2 }));
    }

    return { layer, feature, layerId };
}


// --- EVENTOS GERAIS ---
map.on('pm:create', (e) => {
    const layer = e.layer;
    const geo = layer.toGeoJSON();
    geo.properties.talhao = `${currentFeaturesData.length + 1}`;
    map.removeLayer(layer);

    const result = createLayerFromFeature(geo, false); 
    if (result) {
        currentLayerGroup.addLayer(result.layer);
        currentFeaturesData.push({
            layerId: result.layerId,
            feature: result.feature,
            layerInstance: result.layer
        });
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

// IMPORTAÇÃO
els.inputShp.addEventListener('change', async (ev) => {
    if (typeof shp === 'undefined') return alert('Biblioteca SHP não carregou.');
    const file = ev.target.files[0];
    if (!file) return;

    showToast('Processando...', 'info');
    
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
            
            let rawName = finalFeature.properties.Name || finalFeature.properties.TALHAO || `${index + 1}`;
            finalFeature.properties.talhao = rawName.toString().replace(/Talhão\s*|T-/yi, '').trim();

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
            showToast(`${count} talhões importados.`, 'success');
        }
        ev.target.value = ''; 
    } catch (err) {
        console.error(err);
        showToast('Erro: ' + err.message, 'error');
    }
});

// MODAL
function openModal() {
    els.modalOverlay.classList.remove('hidden');
    els.tableBody.innerHTML = '';
    els.modalFooter.innerHTML = '';
    let totalArea = 0;

    els.modalTitle.textContent = editingFarmId ? 'Editar Fazenda' : 'Cadastrar Fazenda';

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
    btnSave.innerHTML = editingFarmId ? '<i class="fa fa-save"></i> Atualizar' : '<i class="fa fa-save"></i> Confirmar';
    btnSave.onclick = saveToDatabase;
    els.modalFooter.appendChild(btnSave);
    els.modalSummary.innerHTML = `ÁREA TOTAL: ${totalArea.toFixed(2)} Hectares`;
}

function closeModal() { els.modalOverlay.classList.add('hidden'); }
els.btnCloseModal.addEventListener('click', closeModal);

els.btnOpenSave.addEventListener('click', () => {
    const cod = els.inputCod.value.trim();
    const name = els.inputName.value.trim();
    const owner = els.inputOwner.value.trim();
    if (!cod || !name || !owner) return showToast('Preencha os campos obrigatórios.', 'error');
    if (currentFeaturesData.length === 0) return showToast('Mapa vazio.', 'error');
    openModal();
});

window.zoomToLayer = function(id) {
    const item = currentFeaturesData.find(f => f.layerId === id);
    if (item) map.fitBounds(item.layerInstance.getBounds());
};

async function saveToDatabase() {
    const cod = els.inputCod.value.trim();
    const name = els.inputName.value.trim();
    const owner = els.inputOwner.value.trim();
    
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

    showToast('Salvando...', 'info');
    closeModal();

    try {
        let error;
        if (editingFarmId) {
            const payload = { p_id: editingFarmId, p_cod_fazenda: cod, p_name: name, p_owner: owner, p_area_ha: totalArea, p_geojson: featureCollection };
            const res = await sb.rpc('update_farm', payload);
            error = res.error;
        } else {
            const payload = { p_cod_fazenda: cod, p_name: name, p_owner: owner, p_talhao: 'Multi', p_area_ha: totalArea, p_geojson: featureCollection };
            const res = await sb.rpc('insert_farm', payload);
            error = res.error;
        }

        if (error) throw error;
        showToast('Sucesso!', 'success');
        resetApp();
        loadFarms(); 
    } catch (err) {
        console.error(err);
        showToast('Erro: ' + (err.message || err.details), 'error');
    }
}

function resetApp() {
    els.inputCod.value = ''; els.inputName.value = ''; els.inputOwner.value = '';
    currentLayerGroup.clearLayers();
    currentFeaturesData = [];
    editingFarmId = null;
    els.btnOpenSave.innerHTML = '<i class="fa-solid fa-list-check"></i> Revisar & Salvar';
}

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
                    <button class="btn-icon edit-btn"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon view-btn"><i class="fa-solid fa-map"></i></button>
                </div>
            `;
            item.querySelector('.edit-btn').addEventListener('click', () => loadFarmForEditing(farm));
            item.querySelector('.view-btn').addEventListener('click', () => viewFarmOnMap(farm));
            els.farmList.appendChild(item);
        });
    } catch (err) {
        els.farmList.innerHTML = 'Erro.';
    }
}

function loadFarmForEditing(farm) {
    resetApp();
    editingFarmId = farm.id;
    els.inputCod.value = farm.cod_fazenda || '';
    els.inputName.value = farm.name;
    els.inputOwner.value = farm.owner || '';
    els.btnOpenSave.innerHTML = '<i class="fa-solid fa-save"></i> Atualizar';
    showToast(`Editando: ${farm.name}`, 'info');

    if (farm.geojson) {
        let features = farm.geojson.type === 'FeatureCollection' ? farm.geojson.features : [farm.geojson];
        features.forEach(f => {
            const result = createLayerFromFeature(f, false);
            if (result) {
                currentLayerGroup.addLayer(result.layer);
                currentFeaturesData.push({ layerId: result.layerId, feature: result.feature, layerInstance: result.layer });
            }
        });
        map.fitBounds(currentLayerGroup.getBounds());
    }
}

function viewFarmOnMap(farm) {
    currentLayerGroup.clearLayers();
    if (!farm.geojson) return showToast('Erro geometry', 'error');
    let features = farm.geojson.type === 'FeatureCollection' ? farm.geojson.features : [farm.geojson];
    features.forEach(f => {
        const result = createLayerFromFeature(f, true);
        if (result) currentLayerGroup.addLayer(result.layer);
    });
    const bounds = currentLayerGroup.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds);
    
    // Verifica zoom inicial para garantir estado correto dos rótulos
    checkZoomLevel();
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

loadFarms();