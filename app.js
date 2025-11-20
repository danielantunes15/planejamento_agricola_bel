// app.js

// Verifica se o arquivo de configuração foi carregado
if (typeof APP_CONFIG === 'undefined') {
    console.error('ERRO: Arquivo config.js não foi carregado ou está corrompido.');
    alert('Erro de configuração: Verifique o console (F12).');
}

// Inicializa Supabase usando as variáveis do arquivo config.js
const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

// Elementos do DOM
const els = {
    inputName: document.getElementById('input-name'),
    inputOwner: document.getElementById('input-owner'),
    inputTalhao: document.getElementById('input-talhao'),
    inputArea: document.getElementById('input-area'),
    inputShp: document.getElementById('input-shp'),
    btnSave: document.getElementById('btn-save'),
    farmList: document.getElementById('farm-list'),
};

// Estado Global
let currentLayer = null; // Camada sendo desenhada/editada atualmente

// 1. Inicializar Mapa
const map = L.map('map').setView([-12.97, -38.5], 6); // Foco Bahia/Brasil (Ajuste conforme necessidade)

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

// 1.1 Configurar Geoman (Ferramentas de Desenho)
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

map.pm.setLang('pt_br'); // Idioma das tooltips

// Camada para mostrar fazendas salvas (apenas visualização)
const savedFarmsLayer = L.geoJSON(null, {
    style: { color: '#10b981', weight: 2, fillOpacity: 0.2 },
    onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindPopup(`
            <strong>${p.name}</strong><br>
            Talhão: ${p.talhao || '-'}<br>
            Área: ${p.area_ha} ha
        `);
    }
}).addTo(map);

// 2. Eventos de Desenho (Geoman)
map.on('pm:create', (e) => {
    // Se já houver uma camada sendo editada, remove a antiga (regra: 1 novo cadastro por vez)
    if (currentLayer && currentLayer !== e.layer) {
        map.removeLayer(currentLayer);
    }
    
    currentLayer = e.layer;
    setupLayerListeners(currentLayer);
    calculateAndShowArea(currentLayer);
});

function setupLayerListeners(layer) {
    // Recalcular área se o usuário editar os vértices
    layer.on('pm:edit', () => calculateAndShowArea(layer));
}

function calculateAndShowArea(layer) {
    const geojson = layer.toGeoJSON();
    const areaSqMeters = turf.area(geojson);
    const areaHa = areaSqMeters / 10000;
    els.inputArea.value = areaHa.toFixed(2);
    return areaHa;
}

// 3. Importação de Shapefile (.zip)
els.inputShp.addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;

    showToast('Processando arquivo...', 'info');
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const geojson = await shp(arrayBuffer);

        // Limpar desenho atual
        if (currentLayer) map.removeLayer(currentLayer);

        // Pegar a primeira feature (caso o shape tenha várias, simplificamos pegando a primeira para cadastro)
        const feature = geojson.features ? geojson.features[0] : geojson; // shpjs pode retornar featurecollection ou feature
        
        // Criar layer no mapa e habilitar edição
        currentLayer = L.geoJSON(feature).getLayers()[0];
        currentLayer.addTo(map);
        
        // Habilitar ferramentas de edição do Geoman nessa layer importada
        currentLayer.pm.enable(); 
        
        map.fitBounds(currentLayer.getBounds());
        
        // Preencher dados (tenta adivinhar propriedades comuns)
        if (feature.properties) {
            els.inputName.value = feature.properties.Name || feature.properties.NOME || '';
        }
        calculateAndShowArea(currentLayer);
        
        showToast('Shapefile importado! Você pode ajustar os pontos no mapa.', 'success');
        ev.target.value = ''; // Reset input
    } catch (err) {
        console.error(err);
        showToast('Erro ao ler Shapefile. Verifique se é um .zip válido.', 'error');
    }
});

// 4. Salvar no Supabase
els.btnSave.addEventListener('click', async () => {
    const name = els.inputName.value.trim();
    if (!name) return showToast('O nome da fazenda é obrigatório.', 'error');
    if (!currentLayer) return showToast('Desenhe ou importe uma área no mapa.', 'error');

    const geojson = currentLayer.toGeoJSON();
    const area = els.inputArea.value;

    const payload = {
        p_name: name,
        p_owner: els.inputOwner.value,
        p_talhao: els.inputTalhao.value,
        p_area_ha: parseFloat(area),
        p_geojson: geojson.geometry // Enviamos apenas a geometria
    };

    showToast('Salvando...', 'info');

    try {
        const { error } = await sb.rpc('insert_farm', payload);
        if (error) throw error;

        showToast('Fazenda salva com sucesso!', 'success');
        resetForm();
        loadFarms(); // Recarrega a lista
    } catch (err) {
        console.error(err);
        showToast('Erro ao salvar no banco de dados.', 'error');
    }
});

// 5. Carregar Fazendas
async function loadFarms() {
    els.farmList.innerHTML = '<div style="padding:10px; color:#888">Carregando...</div>';
    
    try {
        const { data, error } = await sb.rpc('get_farms');
        if (error) throw error;

        savedFarmsLayer.clearLayers();
        els.farmList.innerHTML = '';

        if (!data || data.length === 0) {
            els.farmList.innerHTML = '<div style="padding:10px; text-align:center; color:#666">Nenhum registro.</div>';
            return;
        }

        data.forEach(farm => {
            // Adicionar ao mapa (visualização)
            savedFarmsLayer.addData({
                type: 'Feature',
                properties: farm,
                geometry: farm.geojson
            });

            // Adicionar à lista lateral
            const item = document.createElement('div');
            item.className = 'farm-item';
            item.innerHTML = `
                <div class="farm-info">
                    <strong>${farm.name}</strong>
                    <div class="farm-meta">
                        ${farm.talhao ? 'Talhão ' + farm.talhao + ' •' : ''} 
                        ${farm.area_ha ? Number(farm.area_ha).toFixed(2) + ' ha' : ''}
                    </div>
                </div>
                <button class="btn-icon" title="Ver no mapa"><i class="fa-solid fa-magnifying-glass-location"></i></button>
            `;
            
            // Clique para dar zoom
            item.querySelector('button').addEventListener('click', () => {
                const tempLayer = L.geoJSON(farm.geojson);
                map.fitBounds(tempLayer.getBounds(), { maxZoom: 15 });
            });

            els.farmList.appendChild(item);
        });

    } catch (err) {
        console.error(err);
        els.farmList.innerHTML = `<div style="color:var(--danger)">Erro ao carregar.</div>`;
    }
}

function resetForm() {
    els.inputName.value = '';
    els.inputOwner.value = '';
    els.inputTalhao.value = '';
    els.inputArea.value = '';
    if (currentLayer) {
        map.removeLayer(currentLayer);
        currentLayer = null;
    }
}

// Utilitário: Toast Notification
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'check-circle';
    if (type === 'error') icon = 'exclamation-circle';
    if (type === 'info') icon = 'info-circle';

    toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> ${msg}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Iniciar
loadFarms();