// app.js

if (typeof APP_CONFIG === 'undefined') {
    console.error('ERRO: config.js ausente.');
    alert('Erro de configuração.');
}

const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

if (typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:32724", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs");
}

// Elementos
const els = {
    inputName: document.getElementById('input-name'),
    inputOwner: document.getElementById('input-owner'),
    inputShp: document.getElementById('input-shp'),
    btnOpenSave: document.getElementById('btn-open-save'),
    farmList: document.getElementById('farm-list'),
    // Modal
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    modalSummary: document.getElementById('modal-summary'),
    tableBody: document.getElementById('talhoes-tbody'),
    modalFooter: document.getElementById('modal-footer-actions')
};

// Variáveis de Estado
let currentLayerGroup = L.featureGroup(); // Grupo para múltiplos polígonos
let currentFeaturesData = []; // Array para guardar os dados temporários (GeoJSONs individuais) antes de salvar
let isViewMode = false; // Se estamos vendo uma fazenda salva ou criando nova

// --- MAPA E CAMADAS ---
const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '© Google Maps'
});
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
});

const map = L.map('map', {
    center: [-12.97, -38.5],
    zoom: 6,
    layers: [googleSat]
});

L.control.layers({ "Google Satélite": googleSat, "Mapa de Estradas": osm }).addTo(map);

// Adiciona o grupo de camadas ao mapa
currentLayerGroup.addTo(map);

// Configuração Geoman (para desenhar manualmente se precisar)
map.pm.addControls({
    position: 'topleft',
    drawCircle: false, drawCircleMarker: false, drawMarker: false, drawPolyline: false,
    drawRectangle: true, drawPolygon: true, editMode: true, dragMode: false, cutPolygon: false, removalMode: true
});
map.pm.setLang('pt_br');

// Evento de desenho manual (adiciona ao nosso array de features)
map.on('pm:create', (e) => {
    const layer = e.layer;
    currentLayerGroup.addLayer(layer);
    
    // Adiciona aos dados temporários
    const geo = layer.toGeoJSON();
    geo.properties.tempId = L.stamp(layer); // ID temporário para linkar tabela <-> mapa
    geo.properties.talhao = `T-${currentFeaturesData.length + 1}`; // Sugestão de nome
    
    currentFeaturesData.push({
        layerId: L.stamp(layer),
        feature: geo,
        layerInstance: layer
    });

    layer.on('pm:edit', () => updateFeatureData(layer));
});

function updateFeatureData(layer) {
    const id = L.stamp(layer);
    const index = currentFeaturesData.findIndex(f => f.layerId === id);
    if (index !== -1) {
        // Atualiza geometria
        currentFeaturesData[index].feature = layer.toGeoJSON();
        currentFeaturesData[index].feature.properties.tempId = id;
    }
}

// --- FUNÇÃO CONVERSOR UTM ---
function reprojectFeature(feature) {
    const transformCoords = (coords) => {
        if (typeof coords[0] === 'number') {
            const x = coords[0], y = coords[1];
            if (Math.abs(x) > 180 || Math.abs(y) > 90) {
                return proj4("EPSG:32724", "EPSG:4326", [x, y]);
            }
            return coords; 
        }
        return coords.map(transformCoords);
    };
    const newFeature = JSON.parse(JSON.stringify(feature));
    newFeature.geometry.coordinates = transformCoords(newFeature.geometry.coordinates);
    return newFeature;
}

// --- IMPORTAÇÃO SHP ---
els.inputShp.addEventListener('change', async (ev) => {
    if (typeof shp === 'undefined') return alert('Erro: shpjs não carregou.');
    
    const file = ev.target.files[0];
    if (!file) return;

    showToast('Lendo arquivo com múltiplos talhões...', 'info');
    currentLayerGroup.clearLayers();
    currentFeaturesData = [];

    try {
        const arrayBuffer = await file.arrayBuffer();
        let geojson;

        if (file.name.toLowerCase().endsWith('.shp')) {
            const geometries = shp.parseShp(arrayBuffer);
            geojson = { type: "FeatureCollection", features: geometries.map(g => ({ type: "Feature", properties: {}, geometry: g })) };
        } else {
            geojson = await shp(arrayBuffer);
        }

        // Normalizar para array de features
        let featuresArray = [];
        if (Array.isArray(geojson)) { // zip com múltiplos shps
            geojson.forEach(g => featuresArray.push(...g.features));
        } else if (geojson.type === 'FeatureCollection') {
            featuresArray = geojson.features;
        } else {
            featuresArray = [geojson]; // Feature única
        }

        // Processar cada feição
        let count = 0;
        featuresArray.forEach((f, index) => {
            if (!f.geometry) return;

            // Reprojetar UTM -> LatLon
            const finalFeature = reprojectFeature(f);
            
            // Criar Layer Leaflet
            const layer = L.geoJSON(finalFeature, {
                style: { color: '#ffff00', weight: 2, fillOpacity: 0.2 }
            }).getLayers()[0]; // Pega a camada interna do geoJSON group

            if (!layer) return;

            const layerId = L.stamp(layer);
            
            // Tenta pegar nome do DBF ou gera sequencial
            let talhaoName = finalFeature.properties.Name || finalFeature.properties.NOME || finalFeature.properties.TALHAO || `Talhão ${index + 1}`;
            
            finalFeature.properties.talhao = talhaoName;
            finalFeature.properties.tempId = layerId;

            currentLayerGroup.addLayer(layer);
            
            // Salva na memória
            currentFeaturesData.push({
                layerId: layerId,
                feature: finalFeature,
                layerInstance: layer
            });

            // Evento de Highlight ao passar o mouse (futuro)
            layer.on('mouseover', () => layer.setStyle({ weight: 4, fillOpacity: 0.5 }));
            layer.on('mouseout', () => layer.setStyle({ weight: 2, fillOpacity: 0.2 }));
            
            count++;
        });

        if (count > 0) {
            map.fitBounds(currentLayerGroup.getBounds());
            showToast(`${count} talhões detectados! Clique em 'Revisar & Salvar'.`, 'success');
        } else {
            showToast('Nenhum polígono válido encontrado.', 'error');
        }
        
        // Preenche nome da fazenda se possível
        if (featuresArray[0] && featuresArray[0].properties) {
             const p = featuresArray[0].properties;
             els.inputName.value = p.FAZENDA || p.FARM || els.inputName.value;
        }

        ev.target.value = '';

    } catch (err) {
        console.error(err);
        showToast('Erro ao ler arquivo: ' + err.message, 'error');
    }
});

// --- SISTEMA DE MODAL ---

// Abrir Modal (para Salvar ou Visualizar)
function openModal(mode) {
    els.modalOverlay.classList.remove('hidden');
    els.tableBody.innerHTML = '';
    els.modalFooter.innerHTML = '';

    let totalArea = 0;

    if (mode === 'edit') {
        // MODO EDIÇÃO (Antes de salvar)
        els.modalTitle.textContent = 'Revisão de Talhões (Edição)';
        isViewMode = false;

        currentFeaturesData.forEach((item, idx) => {
            // Calcula área atual
            const areaHa = (turf.area(item.feature) / 10000);
            totalArea += areaHa;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="text" value="${item.feature.properties.talhao}" data-id="${item.layerId}" class="input-talhao"></td>
                <td>${areaHa.toFixed(2)} ha</td>
                <td><button class="btn-icon" onclick="zoomToLayer(${item.layerId})"><i class="fa fa-eye"></i></button></td>
            `;
            
            // Hover na tabela destaca mapa
            tr.addEventListener('mouseenter', () => {
                item.layerInstance.setStyle({ color: '#00ffcc', weight: 4, fillOpacity: 0.6 });
            });
            tr.addEventListener('mouseleave', () => {
                item.layerInstance.setStyle({ color: '#ffff00', weight: 2, fillOpacity: 0.2 });
            });

            els.tableBody.appendChild(tr);
        });

        // Botão Final de Salvar
        const btnSave = document.createElement('button');
        btnSave.className = 'primary';
        btnSave.innerHTML = '<i class="fa fa-save"></i> Confirmar e Salvar Fazenda';
        btnSave.onclick = saveToDatabase;
        els.modalFooter.appendChild(btnSave);

    } else if (mode === 'view') {
        // MODO VISUALIZAÇÃO (Somente leitura)
        els.modalTitle.textContent = 'Detalhes da Fazenda';
        isViewMode = true;

        // "currentFeaturesData" aqui já foi carregado com dados do banco
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

        const btnClose = document.createElement('button');
        btnClose.textContent = 'Fechar';
        btnClose.className = 'btn-secondary';
        btnClose.onclick = closeModal;
        els.modalFooter.appendChild(btnClose);
    }

    els.modalSummary.innerHTML = `ÁREA TOTAL DA FAZENDA: ${totalArea.toFixed(2)} Hectares`;
}

function closeModal() {
    els.modalOverlay.classList.add('hidden');
}
els.btnCloseModal.addEventListener('click', closeModal);

// Botão "Revisar e Salvar" da sidebar
els.btnOpenSave.addEventListener('click', () => {
    const name = els.inputName.value.trim();
    if (!name) return showToast('Digite o nome da fazenda primeiro.', 'error');
    if (currentFeaturesData.length === 0) return showToast('Nenhum talhão/polígono no mapa.', 'error');
    openModal('edit');
});

// Zoom auxiliar
window.zoomToLayer = function(id) {
    const item = currentFeaturesData.find(f => f.layerId === id);
    if (item) map.fitBounds(item.layerInstance.getBounds());
};

// --- SALVAR NO BANCO ---
async function saveToDatabase() {
    const name = els.inputName.value.trim();
    const owner = els.inputOwner.value;
    
    // 1. Coletar nomes atualizados da tabela
    const inputs = document.querySelectorAll('.input-talhao');
    inputs.forEach(input => {
        const id = parseInt(input.dataset.id);
        const newVal = input.value;
        const item = currentFeaturesData.find(f => f.layerId === id);
        if (item) item.feature.properties.talhao = newVal;
    });

    // 2. Montar FeatureCollection final
    const finalFeatures = currentFeaturesData.map(item => item.feature);
    const featureCollection = {
        type: "FeatureCollection",
        features: finalFeatures
    };

    // 3. Calcular área total para salvar no registro principal
    const totalArea = (turf.area(featureCollection) / 10000);

    const payload = {
        p_name: name,
        p_owner: owner,
        p_talhao: 'Múltiplos', // Campo texto simples
        p_area_ha: totalArea,
        p_geojson: featureCollection // JSONB guarda tudo
    };

    showToast('Salvando no banco...', 'info');
    closeModal();

    try {
        const { error } = await sb.rpc('insert_farm', payload);
        if (error) throw error;

        showToast('Fazenda e talhões salvos com sucesso!', 'success');
        
        // Limpar tudo
        els.inputName.value = ''; els.inputOwner.value = '';
        currentLayerGroup.clearLayers();
        currentFeaturesData = [];
        loadFarms(); // Recarrega lista lateral

    } catch (err) {
        console.error(err);
        showToast('Erro ao salvar: ' + err.message, 'error');
    }
}

// --- CARREGAR LISTA LATERAL ---
async function loadFarms() {
    els.farmList.innerHTML = 'Carregando...';
    try {
        const { data, error } = await sb.rpc('get_farms');
        if (error) throw error;

        els.farmList.innerHTML = '';
        if (!data || data.length === 0) {
            els.farmList.innerHTML = '<div style="padding:10px; text-align:center;">Nenhum registro.</div>';
            return;
        }

        data.forEach(farm => {
            const item = document.createElement('div');
            item.className = 'farm-item';
            item.innerHTML = `
                <div class="farm-info">
                    <strong>${farm.name}</strong>
                    <div class="farm-meta">${Number(farm.area_ha).toFixed(2)} ha Total</div>
                </div>
                <button class="btn-icon" title="Ver Detalhes"><i class="fa-solid fa-list"></i></button>
            `;
            
            // CLICK NA LISTA: Carregar no Mapa e Abrir Tabela
            item.querySelector('button').addEventListener('click', () => {
                viewFarmOnMap(farm);
            });

            els.farmList.appendChild(item);
        });
    } catch (err) {
        els.farmList.innerHTML = 'Erro ao carregar.';
    }
}

function viewFarmOnMap(farm) {
    currentLayerGroup.clearLayers();
    currentFeaturesData = []; // Reusamos essa var para o View Mode

    if (!farm.geojson) return showToast('Erro: Geometria inválida.', 'error');

    let features = [];
    if (farm.geojson.type === 'FeatureCollection') {
        features = farm.geojson.features;
    } else {
        features = [farm.geojson]; // Compatibilidade com dados antigos
    }

    // Adiciona ao mapa e prepara dados para modal
    features.forEach(f => {
        const layer = L.geoJSON(f, {
            style: { color: '#00ffcc', weight: 2, fillOpacity: 0.3 }
        }).getLayers()[0]; // Unwrap

        if(layer) {
            currentLayerGroup.addLayer(layer);
            currentFeaturesData.push({
                feature: f,
                layerInstance: layer,
                layerId: null // não precisa em view mode
            });
            
            // Tooltip simples
            layer.bindPopup(`Talhão: ${f.properties.talhao || '-'}<br>Area: ${(turf.area(f)/10000).toFixed(2)} ha`);
        }
    });

    map.fitBounds(currentLayerGroup.getBounds());
    
    // Abre Modal com a tabela
    openModal('view');
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

// Iniciar
loadFarms();