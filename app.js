// app.js

// Verifica configuração
if (typeof APP_CONFIG === 'undefined') {
    console.error('ERRO: config.js ausente.');
    alert('Erro de configuração.');
}

// Inicializa Supabase
const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

// Define a projeção UTM 24S (SIRGAS 2000 / UTM zone 24S é compatível com WGS84 para web maps)
// EPSG:32724
if (typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:32724", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs");
}

// Elementos
const els = {
    inputName: document.getElementById('input-name'),
    inputOwner: document.getElementById('input-owner'),
    inputTalhao: document.getElementById('input-talhao'),
    inputArea: document.getElementById('input-area'),
    inputShp: document.getElementById('input-shp'),
    btnSave: document.getElementById('btn-save'),
    farmList: document.getElementById('farm-list'),
};

let currentLayer = null; 

// Inicializar Mapa
const map = L.map('map').setView([-12.97, -38.5], 6); 

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

// Geoman
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

// Layer de Fazendas Salvas
const savedFarmsLayer = L.geoJSON(null, {
    style: { color: '#10b981', weight: 2, fillOpacity: 0.2 },
    onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindPopup(`<strong>${p.name}</strong><br>Talhão: ${p.talhao || '-'}<br>Área: ${p.area_ha} ha`);
    }
}).addTo(map);

// Eventos Geoman
map.on('pm:create', (e) => {
    if (currentLayer && currentLayer !== e.layer) map.removeLayer(currentLayer);
    currentLayer = e.layer;
    setupLayerListeners(currentLayer);
    calculateAndShowArea(currentLayer);
});

function setupLayerListeners(layer) {
    layer.on('pm:edit', () => calculateAndShowArea(layer));
}

function calculateAndShowArea(layer) {
    const geojson = layer.toGeoJSON();
    const areaSqMeters = turf.area(geojson);
    const areaHa = areaSqMeters / 10000;
    els.inputArea.value = areaHa.toFixed(2);
    return areaHa;
}

// --- FUNÇÃO MÁGICA: CONVERSOR UTM PARA LATLON ---
function reprojectFeature(feature) {
    // Função recursiva para percorrer arrays aninhados de coordenadas (Polygon ou MultiPolygon)
    const transformCoords = (coords) => {
        // Se for um par de coordenadas [x, y]
        if (typeof coords[0] === 'number') {
            const x = coords[0];
            const y = coords[1];
            
            // Lógica simples: Se X > 180, assumimos que é UTM (metros) e não Graus
            if (Math.abs(x) > 180 || Math.abs(y) > 90) {
                // Converte de UTM 24S (EPSG:32724) para WGS84 (EPSG:4326)
                return proj4("EPSG:32724", "EPSG:4326", [x, y]);
            }
            return coords; // Já está em lat/lon
        }
        // Se for array de arrays, desce um nível
        return coords.map(transformCoords);
    };

    // Clona a feature para não estragar a original
    const newFeature = JSON.parse(JSON.stringify(feature));
    newFeature.geometry.coordinates = transformCoords(newFeature.geometry.coordinates);
    return newFeature;
}

// Upload Shapefile
els.inputShp.addEventListener('change', async (ev) => {
    if (typeof shp === 'undefined') return alert('Biblioteca shpjs não carregou.');
    if (typeof proj4 === 'undefined') return alert('Biblioteca proj4 não carregou.');

    const file = ev.target.files[0];
    if (!file) return;

    showToast('Processando e convertendo coordenadas...', 'info');
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        let geojson;

        if (file.name.toLowerCase().endsWith('.shp')) {
            const geometries = shp.parseShp(arrayBuffer);
            if (!geometries || geometries.length === 0) throw new Error("Geometria vazia.");
            geojson = {
                type: "FeatureCollection",
                features: geometries.map(geom => ({ type: "Feature", properties: {}, geometry: geom }))
            };
        } else {
            geojson = await shp(arrayBuffer);
        }

        if (currentLayer) map.removeLayer(currentLayer);

        // Normalização
        let feature;
        if (Array.isArray(geojson)) {
            if (geojson.length > 0) feature = geojson[0];
        } else {
            feature = geojson;
        }
        
        if (feature && feature.type === 'FeatureCollection' && feature.features.length > 0) {
            feature = feature.features[0];
        }

        if (!feature || !feature.geometry) throw new Error("Nenhuma geometria válida.");

        // --- AQUI ACONTECE A MÁGICA ---
        // Reprojeta de UTM 24S para Lat/Lon se necessário
        const finalFeature = reprojectFeature(feature);
        // ------------------------------

        currentLayer = L.geoJSON(finalFeature).getLayers()[0];
        currentLayer.addTo(map);
        currentLayer.pm.enable(); 
        
        const bounds = currentLayer.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds);
        } else {
            showToast('Coordenadas inválidas mesmo após conversão.', 'error');
        }

        if (finalFeature.properties) {
            els.inputName.value = finalFeature.properties.Name || finalFeature.properties.NOME || '';
        }
        
        calculateAndShowArea(currentLayer);
        showToast('Importado com sucesso (UTM 24S detectado)!', 'success');
        ev.target.value = ''; 

    } catch (err) {
        console.error("Erro:", err);
        showToast('Erro: ' + err.message, 'error');
    }
});

// Salvar
els.btnSave.addEventListener('click', async () => {
    const name = els.inputName.value.trim();
    if (!name) return showToast('Nome obrigatório.', 'error');
    if (!currentLayer) return showToast('Sem área desenhada.', 'error');

    const geojson = currentLayer.toGeoJSON();
    const area = els.inputArea.value;

    const payload = {
        p_name: name,
        p_owner: els.inputOwner.value,
        p_talhao: els.inputTalhao.value,
        p_area_ha: parseFloat(area),
        p_geojson: geojson.geometry 
    };

    showToast('Salvando...', 'info');

    try {
        const { error } = await sb.rpc('insert_farm', payload);
        if (error) throw error;

        showToast('Salvo com sucesso!', 'success');
        resetForm();
        loadFarms(); 
    } catch (err) {
        console.error(err);
        showToast('Erro ao salvar.', 'error');
    }
});

// Carregar
async function loadFarms() {
    els.farmList.innerHTML = 'Carregando...';
    try {
        const { data, error } = await sb.rpc('get_farms');
        if (error) throw error;

        savedFarmsLayer.clearLayers();
        els.farmList.innerHTML = '';

        if (!data || data.length === 0) {
            els.farmList.innerHTML = '<div style="padding:10px; text-align:center;">Nenhum registro.</div>';
            return;
        }

        data.forEach(farm => {
            if (farm.geojson) {
                savedFarmsLayer.addData({ type: 'Feature', properties: farm, geometry: farm.geojson });
            }
            const item = document.createElement('div');
            item.className = 'farm-item';
            item.innerHTML = `
                <div class="farm-info">
                    <strong>${farm.name}</strong>
                    <div class="farm-meta">${farm.talhao ? 'T: '+farm.talhao : ''} • ${Number(farm.area_ha).toFixed(2)} ha</div>
                </div>
                <button class="btn-icon"><i class="fa-solid fa-magnifying-glass-location"></i></button>
            `;
            item.querySelector('button').addEventListener('click', () => {
                if (farm.geojson) map.fitBounds(L.geoJSON(farm.geojson).getBounds(), { maxZoom: 15 });
            });
            els.farmList.appendChild(item);
        });
    } catch (err) {
        els.farmList.innerHTML = 'Erro ao carregar.';
    }
}

function resetForm() {
    els.inputName.value = ''; els.inputOwner.value = ''; els.inputTalhao.value = ''; els.inputArea.value = '';
    if (currentLayer) { map.removeLayer(currentLayer); currentLayer = null; }
}

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = type === 'error' ? 'exclamation-circle' : 'check-circle';
    toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

loadFarms();