// js/fazendas.js - Módulo de Fazendas e Mapa CRUD

let mapFazendas = null;
let layerGroupFazendas = null;
let currentFeaturesData = []; 
let editingFarmId = null;

const elsMap = {
    inputCod: document.getElementById('input-cod'),
    inputName: document.getElementById('input-name'),
    inputOwner: document.getElementById('input-owner'),
    inputShp: document.getElementById('input-shp'),
    btnOpenSave: document.getElementById('btn-open-save'),
    btnCancel: document.getElementById('btn-cancel-edit'),
    farmList: document.getElementById('farm-list'),
    modalOverlay: document.getElementById('modal-overlay'),
    tableBody: document.getElementById('talhoes-tbody'),
    modalFooter: document.getElementById('modal-footer-actions'),
    modalSummary: document.getElementById('modal-summary')
};

// Inicializa mapa apenas quando necessário
window.initFazendasMap = function() {
    if(mapFazendas) {
        setTimeout(() => mapFazendas.invalidateSize(), 200);
        return;
    }

    const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 21, subdomains: ['mt0','mt1','mt2','mt3'] });
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });

    mapFazendas = L.map('map', { center: USINA_COORDS, zoom: 13, layers: [googleSat] });
    L.control.layers({ "Satélite": googleSat, "Mapa": osm }).addTo(mapFazendas);
    
    // Grupo de Layers editáveis
    layerGroupFazendas = L.featureGroup().addTo(mapFazendas);

    // Ícone Usina
    const usinaIconCrud = L.divIcon({
        html: '<i class="fa-solid fa-industry" style="color: #fff; font-size: 20px; text-shadow: 0 2px 5px black;"></i>',
        className: 'custom-div-icon', iconSize: [20, 20], iconAnchor: [10, 10]
    });
    L.marker(USINA_COORDS, { icon: usinaIconCrud }).addTo(mapFazendas);

    // Controles Geoman (Edição)
    mapFazendas.pm.addControls({ position: 'topleft', drawCircle: false, drawMarker: false, drawPolyline: false, drawCircleMarker: false });
    mapFazendas.pm.setLang('pt_br');

    // Zoom inteligente
    mapFazendas.on('zoomend', () => {
        const div = document.getElementById('map');
        if(mapFazendas.getZoom() < 14) div.classList.add('hide-labels');
        else div.classList.remove('hide-labels');
    });

    loadFarms(); // Carrega lista inicial
}

window.loadOwnersForSelect = async function() {
    const { data } = await sb.rpc('get_fornecedores');
    const dataList = document.getElementById('owners-list');
    if(!data || !dataList) return;
    dataList.innerHTML = ''; 
    data.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.nome;
        opt.label = `${o.cod_fornecedor || ''} - ${o.nome}`;
        dataList.appendChild(opt);
    });
}

function createLayerFromFeature(feature, isReadOnly) {
    if (!feature.properties) feature.properties = {};
    const calcArea = (turf.area(feature) / 10000);
    let displayArea = feature.properties.area_manual ? parseFloat(feature.properties.area_manual) : calcArea;
    let rawName = feature.properties.talhao || '';
    let labelName = rawName.replace(/Talhão\s*|T-/yi, '').trim() || "?";

    const layer = L.geoJSON(feature, {
        style: { color: isReadOnly ? '#00ffcc' : '#ffff00', weight: isReadOnly ? 2 : 3, fillOpacity: 0.2 }
    }).getLayers()[0];

    if (!layer) return null;
    const layerId = L.stamp(layer);
    feature.properties.tempId = layerId;

    const labelContent = `<div style="line-height:1;text-align:center;"><span style="font-size:14px;display:block;">${labelName}</span><span style="font-size:10px;opacity:0.9;">${displayArea.toFixed(2)} ha</span></div>`;
    layer.bindTooltip(labelContent, { permanent: true, direction: 'center', className: 'talhao-label', interactive: false });

    if (!isReadOnly) {
        const content = document.createElement('div');
        content.className = 'edit-popup-form';
        content.innerHTML = `
            <label>Talhão:</label><input type="text" id="en-${layerId}" value="${labelName}">
            <label>Área (ha):</label><input type="number" step="0.01" id="ea-${layerId}" value="${displayArea.toFixed(2)}">
            <button id="bs-${layerId}" style="margin-top:5px;background:#10b981;color:#fff;border:0;padding:5px;cursor:pointer;border-radius:3px;">Ok</button>`;
        
        layer.bindPopup(content);
        layer.on('popupopen', () => {
            const btn = document.getElementById(`bs-${layerId}`);
            if(btn) btn.onclick = () => {
                const item = currentFeaturesData.find(f => f.layerId === layerId);
                if(item) {
                    item.feature.properties.talhao = document.getElementById(`en-${layerId}`).value;
                    item.feature.properties.area_manual = parseFloat(document.getElementById(`ea-${layerId}`).value);
                    const newArea = item.feature.properties.area_manual;
                    layer.setTooltipContent(`<div style="line-height:1;text-align:center;"><span style="font-size:14px;display:block;">${item.feature.properties.talhao}</span><span style="font-size:10px;opacity:0.9;">${newArea.toFixed(2)} ha</span></div>`);
                    layer.closePopup();
                    showToast('Atualizado');
                }
            };
        });
    }
    return { layer, feature, layerId };
}

// Eventos
elsMap.inputShp.addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if(!editingFarmId) { layerGroupFazendas.clearLayers(); currentFeaturesData = []; }
    try {
        const buf = await file.arrayBuffer();
        let geo = file.name.endsWith('.shp') ? shp.parseShp(buf).map(g=>({type:'Feature',properties:{},geometry:g})) : await shp(buf);
        let feats = Array.isArray(geo) ? (geo[0].features ? geo[0].features : geo) : geo.features;
        if(!feats) throw new Error("Sem feições");
        feats.forEach((f, idx) => {
            if(!f.geometry) return;
            // Transformação UTM se necessário (simplificado)
            const transform = (c) => (typeof c[0]==='number' && (Math.abs(c[0])>180||Math.abs(c[1])>90)) ? proj4("EPSG:32724","EPSG:4326",c) : (Array.isArray(c[0])?c.map(transform):c);
            f.geometry.coordinates = transform(f.geometry.coordinates);
            f.properties.talhao = f.properties.Name || f.properties.TALHAO || `${idx+1}`;
            const res = createLayerFromFeature(f, false);
            if(res) {
                layerGroupFazendas.addLayer(res.layer);
                currentFeaturesData.push({ layerId: res.layerId, feature: res.feature });
            }
        });
        const bounds = layerGroupFazendas.getBounds();
        if(bounds.isValid()) mapFazendas.fitBounds(bounds);
        ev.target.value = '';
    } catch(e) { alert('Erro SHP: '+e.message); }
});

elsMap.btnOpenSave.addEventListener('click', () => {
    if(!elsMap.inputCod.value || !elsMap.inputName.value || !elsMap.inputOwner.value) return showToast('Preencha campos obrigatórios', 'error');
    if(currentFeaturesData.length===0) return showToast('Mapa vazio', 'error');
    
    elsMap.modalOverlay.classList.remove('hidden');
    elsMap.tableBody.innerHTML = '';
    elsMap.modalFooter.innerHTML = '';
    let total = 0;
    currentFeaturesData.forEach(i => {
        let area = i.feature.properties.area_manual || (turf.area(i.feature)/10000);
        total += parseFloat(area);
        elsMap.tableBody.innerHTML += `<tr><td>${i.feature.properties.talhao}</td><td>${area.toFixed(2)} ha</td><td></td></tr>`;
    });
    elsMap.modalSummary.innerHTML = `Total: ${total.toFixed(2)} ha`;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.innerHTML = editingFarmId ? 'Atualizar' : 'Confirmar';
    btn.onclick = saveFarmDB;
    elsMap.modalFooter.appendChild(btn);
});

async function saveFarmDB() {
    const payload = {
        p_cod_fazenda: elsMap.inputCod.value,
        p_name: elsMap.inputName.value,
        p_owner: elsMap.inputOwner.value,
        p_talhao: 'Multi',
        p_area_ha: parseFloat(elsMap.modalSummary.innerText.replace('Total: ','').replace(' ha','')),
        p_geojson: { type: "FeatureCollection", features: currentFeaturesData.map(i=>i.feature) }
    };
    
    let err;
    if(editingFarmId) { payload.p_id = editingFarmId; err = (await sb.rpc('update_farm', payload)).error; } 
    else { err = (await sb.rpc('insert_farm', payload)).error; }
    
    if(err) showToast('Erro: '+err.message, 'error');
    else { showToast('Salvo!'); elsMap.modalOverlay.classList.add('hidden'); resetFarmForm(); }
}

window.resetFarmForm = function() {
    elsMap.inputCod.value=''; elsMap.inputName.value=''; elsMap.inputOwner.value='';
    layerGroupFazendas.clearLayers(); currentFeaturesData=[]; editingFarmId=null;
    elsMap.btnOpenSave.innerHTML = 'Revisar & Salvar';
    elsMap.btnCancel.classList.add('hidden');
    loadFarms();
}
window.cancelEditFarm = function() { resetFarmForm(); }

async function loadFarms() {
    elsMap.farmList.innerHTML = 'Carregando...';
    const { data } = await sb.rpc('get_farms');
    elsMap.farmList.innerHTML = '';
    layerGroupFazendas.clearLayers(); 
    const bounds = L.latLngBounds([USINA_COORDS]);

    if(data && data.length > 0) {
        data.forEach(f => {
            const d = document.createElement('div'); d.className='farm-item';
            d.innerHTML = `<div><small>${f.cod_fazenda||''}</small><br><strong>${f.name}</strong></div><div><button class="btn-icon e"><i class="fa-solid fa-pen"></i></button><button class="btn-icon v"><i class="fa-solid fa-map"></i></button></div>`;
            d.querySelector('.e').onclick = () => editFarm(f);
            d.querySelector('.v').onclick = () => viewFarm(f);
            elsMap.farmList.appendChild(d);

            const feats = f.geojson.features || [f.geojson];
            feats.forEach(ft => {
                const res = createLayerFromFeature(ft, true); // ReadOnly no fundo
                if(res) { 
                    layerGroupFazendas.addLayer(res.layer); 
                    if(res.layer.getBounds().isValid()) bounds.extend(res.layer.getBounds());
                }
            });
        });
        mapFazendas.fitBounds(bounds, { padding: [50, 50] });
    } else { elsMap.farmList.innerHTML = 'Vazio'; }
}

function viewFarm(f) {
    const tempGroup = L.featureGroup();
    const feats = f.geojson.features || [f.geojson];
    feats.forEach(ft => tempGroup.addLayer(L.geoJSON(ft)));
    mapFazendas.fitBounds(tempGroup.getBounds());
}

function editFarm(f) {
    layerGroupFazendas.clearLayers(); currentFeaturesData = [];
    editingFarmId = f.id;
    elsMap.inputCod.value = f.cod_fazenda; elsMap.inputName.value = f.name; elsMap.inputOwner.value = f.owner;
    elsMap.btnOpenSave.innerHTML = 'Atualizar';
    elsMap.btnCancel.classList.remove('hidden');
    
    const feats = f.geojson.features || [f.geojson];
    feats.forEach(ft => {
        const res = createLayerFromFeature(ft, false); // Editável
        if(res) { 
            layerGroupFazendas.addLayer(res.layer); 
            currentFeaturesData.push({ layerId: res.layerId, feature: res.feature }); 
        }
    });
    mapFazendas.fitBounds(layerGroupFazendas.getBounds());
}