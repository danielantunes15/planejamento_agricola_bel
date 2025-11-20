// js/app.js - BEL AGRÍCOLA (Versão Final Completa)

// 1. VERIFICAÇÃO DE CONFIGURAÇÃO
if (typeof APP_CONFIG === 'undefined') {
    alert('ERRO CRÍTICO: config.js não encontrado na pasta js. Verifique se o arquivo existe.');
}

// 2. INICIALIZAÇÃO DO SUPABASE
const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

// 3. DEFINIÇÃO DE PROJEÇÃO (UTM 24S -> WGS84)
if (typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:32724", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs");
}
const USINA_COORDS = [-17.643763707243053, -40.18234136873469];

// --- GESTÃO DE NAVEGAÇÃO (ABAS) ---
window.switchView = function(viewId) {
    // Atualiza Botões do Menu
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[onclick="switchView('${viewId}')"]`);
    if(activeBtn) activeBtn.classList.add('active');

    // Troca as Telas
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(`view-${viewId}`);
    if(view) view.classList.add('active');

    // Ações específicas ao abrir cada tela
    if(viewId === 'fazendas') {
        // Corrige tamanho do mapa ao abrir a aba
        setTimeout(() => { 
            if(typeof map !== 'undefined') map.invalidateSize(); 
        }, 200);
        loadOwnersForSelect(); // Atualiza lista de pesquisa de fornecedores
    }
    if(viewId === 'proprietarios') loadOwnersList();
    if(viewId === 'frentes') loadFrontsList();
}


// ============================================================
// 1. MÓDULO PROPRIETÁRIOS (FORNECEDORES)
// ============================================================
async function loadOwnersList() {
    const tbody = document.getElementById('owner-list-body');
    if(!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Carregando...</td></tr>';
    
    const { data, error } = await sb.rpc('get_fornecedores'); // RPC novo
    
    if (error) {
        console.error("Erro fornecedores:", error);
        tbody.innerHTML = `<tr><td colspan="5" style="color:red">Erro: ${error.message}</td></tr>`;
        return;
    }
    tbody.innerHTML = '';
    
    if(!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#777;">Nenhum fornecedor cadastrado.</td></tr>';
        return;
    }

    data.forEach(o => {
        // Prepara objeto seguro para passar no onclick
        const jsonItem = JSON.stringify(o).replace(/"/g, '&quot;');
        tbody.innerHTML += `
            <tr>
                <td>${o.cod_fornecedor || '-'}</td>
                <td><strong>${o.nome}</strong></td>
                <td>${o.cpf_cnpj || '-'}</td>
                <td>${o.telefone || '-'}</td>
                <td>
                    <button class="btn-icon" onclick="editOwner(${jsonItem})" title="Editar"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon" style="color:#ef4444" onclick="delOwner('${o.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    });
}

window.saveOwner = async function() {
    const id = document.getElementById('owner-id').value;
    const p = {
        p_cod: document.getElementById('owner-cod').value,
        p_nome: document.getElementById('owner-name').value,
        p_cpf: document.getElementById('owner-cpf').value,
        p_tel: document.getElementById('owner-tel').value
    };

    if(!p.p_nome) return showToast('O Nome é obrigatório.', 'error');
    
    showToast('Salvando...', 'info');
    
    let result;
    if(id) { 
        p.p_id = id; // ID é UUID (string)
        result = await sb.rpc('update_fornecedor', p); 
    } else { 
        result = await sb.rpc('insert_fornecedor', p); 
    }
    
    if(result.error) {
        console.error(result.error);
        showToast('Erro ao salvar: ' + result.error.message, 'error');
    } else {
        showToast('Fornecedor salvo com sucesso!');
        clearOwnerForm();
        loadOwnersList();
    }
};

window.editOwner = function(o) {
    // Preenche formulário para edição
    document.getElementById('owner-id').value = o.id;
    document.getElementById('owner-cod').value = o.cod_fornecedor || '';
    document.getElementById('owner-name').value = o.nome || '';
    document.getElementById('owner-cpf').value = o.cpf_cnpj || '';
    document.getElementById('owner-tel').value = o.telefone || '';
    // Rola para o topo
    const container = document.querySelector('#view-proprietarios .crud-container');
    if(container) container.scrollTo(0,0);
}

window.clearOwnerForm = function() {
    document.getElementById('owner-id').value = '';
    document.querySelectorAll('#view-proprietarios input').forEach(i => i.value = '');
}

window.delOwner = async function(id) {
    if(confirm('Tem certeza que deseja excluir este fornecedor?')) {
        const { error } = await sb.rpc('delete_fornecedor', {p_id: id});
        if(error) showToast('Erro ao excluir: ' + error.message, 'error');
        else {
            showToast('Excluído com sucesso.');
            loadOwnersList();
        }
    }
}


// ============================================================
// 2. MÓDULO FRENTES DE SERVIÇO
// ============================================================
async function loadFrontsList() {
    const tbody = document.getElementById('front-list-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center">Carregando...</td></tr>';
    
    const { data, error } = await sb.rpc('get_frentes');
    
    if (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="3">Erro: ${error.message}</td></tr>`;
        return;
    }
    tbody.innerHTML = '';
    if(!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#777;">Nenhuma frente cadastrada.</td></tr>';
        return;
    }
    data.forEach(f => {
        const jsonItem = JSON.stringify(f).replace(/"/g, '&quot;');
        tbody.innerHTML += `
            <tr>
                <td>${f.cod_frente || '-'}</td>
                <td><strong>${f.nome}</strong></td>
                <td>
                    <button class="btn-icon" onclick="editFront(${jsonItem})"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon" style="color:#ef4444" onclick="delFront(${f.id})"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    });
}

window.saveFront = async function() {
    const id = document.getElementById('front-id').value;
    const p = {
        p_cod: document.getElementById('front-cod').value,
        p_nome: document.getElementById('front-name').value
    };

    if(!p.p_nome) return showToast('Nome da frente é obrigatório.', 'error');
    
    let result;
    if(id) { 
        p.p_id = id; 
        result = await sb.rpc('update_frente', p); 
    } else { 
        result = await sb.rpc('insert_frente', p); 
    }
    
    if(result.error) showToast('Erro: ' + result.error.message, 'error');
    else { showToast('Salvo com sucesso!'); clearFrontForm(); loadFrontsList(); }
};

window.editFront = function(f) {
    document.getElementById('front-id').value = f.id;
    document.getElementById('front-cod').value = f.cod_frente || '';
    document.getElementById('front-name').value = f.nome || '';
}
window.clearFrontForm = function() {
    document.getElementById('front-id').value = '';
    document.querySelectorAll('#view-frentes input').forEach(i => i.value = '');
}
window.delFront = async function(id) {
    if(confirm('Excluir esta frente?')) {
        const { error } = await sb.rpc('delete_frente', {p_id: id});
        if(error) showToast('Erro: ' + error.message, 'error');
        else loadFrontsList();
    }
}


// ============================================================
// 3. MÓDULO FAZENDAS (MAPA)
// ============================================================
const elsMap = {
    inputCod: document.getElementById('input-cod'),
    inputName: document.getElementById('input-name'),
    inputOwner: document.getElementById('input-owner'), // Input do datalist
    inputShp: document.getElementById('input-shp'),
    btnOpenSave: document.getElementById('btn-open-save'),
    btnCancel: document.getElementById('btn-cancel-edit'),
    farmList: document.getElementById('farm-list'),
    // Modal
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    tableBody: document.getElementById('talhoes-tbody'),
    modalFooter: document.getElementById('modal-footer-actions'),
    modalSummary: document.getElementById('modal-summary')
};

let currentLayerGroup = L.featureGroup(); 
let currentFeaturesData = []; 
let editingFarmId = null;

// --- MAPA SETUP ---
const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 21, subdomains: ['mt0','mt1','mt2','mt3'] });
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });

// Inicia focado na USINA
const map = L.map('map', { 
    center: USINA_COORDS, 
    zoom: 13, 
    layers: [googleSat] 
});
L.control.layers({ "Satélite": googleSat, "Mapa": osm }).addTo(map);
currentLayerGroup.addTo(map);

// Marcador da Usina
const usinaIcon = L.divIcon({
    html: '<i class="fa-solid fa-industry" style="color: #fff; font-size: 26px; text-shadow: 0 2px 5px black;"></i>',
    className: 'custom-div-icon',
    iconSize: [30, 30], iconAnchor: [15, 15]
});
L.marker(USINA_COORDS, { icon: usinaIcon }).addTo(map).bindPopup("<strong>USINA BEL</strong>").openPopup();

map.pm.addControls({ position: 'topleft', drawCircle: false, drawMarker: false, drawPolyline: false, drawCircleMarker: false });
map.pm.setLang('pt_br');

// Zoom inteligente (Esconde rótulos de longe)
map.on('zoomend', () => {
    const div = document.getElementById('map');
    if(map.getZoom() < 14) div.classList.add('hide-labels');
    else div.classList.remove('hide-labels');
});
// Estado inicial
if(map.getZoom() < 14) document.getElementById('map').classList.add('hide-labels');


// --- CARREGAR FORNECEDORES (PESQUISA) ---
async function loadOwnersForSelect() {
    // Busca fornecedores ordenados alfabeticamente (conforme novo SQL)
    const { data } = await sb.rpc('get_fornecedores');
    const dataList = document.getElementById('owners-list'); // O elemento <datalist>
    
    if(!data || !dataList) return;
    
    dataList.innerHTML = ''; // Limpa opções antigas
    data.forEach(o => {
        const opt = document.createElement('option');
        // O valor é o nome (o que é salvo no banco da fazenda)
        opt.value = o.nome;
        // O texto auxiliar mostra código e nome
        opt.label = `${o.cod_fornecedor || ''} - ${o.nome}`;
        dataList.appendChild(opt);
    });
}

// --- LÓGICA DE LAYER E RÓTULOS ---
function createLayerFromFeature(feature, isReadOnly) {
    if (!feature.properties) feature.properties = {};
    const calcArea = (turf.area(feature) / 10000);
    // Usa manual se tiver, senão calculada
    let displayArea = feature.properties.area_manual ? parseFloat(feature.properties.area_manual) : calcArea;
    
    // Limpa nome visualmente
    let rawName = feature.properties.talhao || '';
    let labelName = rawName.replace(/Talhão\s*|T-/yi, '').trim() || "?";

    const layer = L.geoJSON(feature, {
        style: { color: isReadOnly ? '#00ffcc' : '#ffff00', weight: isReadOnly ? 2 : 3, fillOpacity: 0.2 }
    }).getLayers()[0];

    if (!layer) return null;
    const layerId = L.stamp(layer);
    feature.properties.tempId = layerId;

    // Rótulo Fixo
    const labelContent = `<div style="line-height:1;text-align:center;"><span style="font-size:14px;display:block;">${labelName}</span><span style="font-size:10px;opacity:0.9;">${displayArea.toFixed(2)} ha</span></div>`;
    layer.bindTooltip(labelContent, { permanent: true, direction: 'center', className: 'talhao-label', interactive: false });

    // Popup de Edição (Só se não for ReadOnly)
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
                    
                    // Atualiza visualmente
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

// Upload SHP
elsMap.inputShp.addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    
    // Se for cadastro novo, limpa mapa
    if(!editingFarmId) { currentLayerGroup.clearLayers(); currentFeaturesData = []; }
    
    try {
        const buf = await file.arrayBuffer();
        let geo = file.name.endsWith('.shp') ? shp.parseShp(buf).map(g=>({type:'Feature',properties:{},geometry:g})) : await shp(buf);
        let feats = Array.isArray(geo) ? (geo[0].features ? geo[0].features : geo) : geo.features;
        
        if(!feats) throw new Error("Sem feições");

        feats.forEach((f, idx) => {
            if(!f.geometry) return;
            // Reprojeção
            const transform = (c) => (typeof c[0]==='number' && (Math.abs(c[0])>180||Math.abs(c[1])>90)) ? proj4("EPSG:32724","EPSG:4326",c) : (Array.isArray(c[0])?c.map(transform):c);
            f.geometry.coordinates = transform(f.geometry.coordinates);
            
            f.properties.talhao = f.properties.Name || f.properties.TALHAO || `${idx+1}`;
            
            const res = createLayerFromFeature(f, false);
            if(res) {
                currentLayerGroup.addLayer(res.layer);
                currentFeaturesData.push({ layerId: res.layerId, feature: res.feature, layerInstance: res.layer });
            }
        });
        
        const bounds = currentLayerGroup.getBounds();
        if(bounds.isValid()) map.fitBounds(bounds);
        ev.target.value = '';
    } catch(e) { alert('Erro SHP: '+e.message); }
});

// Botão Salvar
elsMap.btnOpenSave.addEventListener('click', () => {
    if(!elsMap.inputCod.value || !elsMap.inputName.value || !elsMap.inputOwner.value) return showToast('Preencha campos obrigatórios', 'error');
    if(currentFeaturesData.length===0) return showToast('Mapa vazio', 'error');
    openModalMap();
});

function openModalMap() {
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
}

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
    if(editingFarmId) { 
        payload.p_id = editingFarmId; 
        err = (await sb.rpc('update_farm', payload)).error; 
    } else { 
        err = (await sb.rpc('insert_farm', payload)).error; 
    }
    
    if(err) showToast('Erro: '+err.message, 'error');
    else { 
        showToast('Salvo com sucesso!'); 
        elsMap.modalOverlay.classList.add('hidden'); 
        resetFarmForm(); 
    }
}

function resetFarmForm() {
    elsMap.inputCod.value=''; elsMap.inputName.value=''; elsMap.inputOwner.value='';
    currentLayerGroup.clearLayers(); currentFeaturesData=[]; editingFarmId=null;
    elsMap.btnOpenSave.innerHTML = 'Revisar & Salvar';
    if(elsMap.btnCancel) elsMap.btnCancel.classList.add('hidden');
    loadFarms();
}
window.cancelEditFarm = function() { resetFarmForm(); }

// --- CARREGAR FAZENDAS ---
async function loadFarms() {
    elsMap.farmList.innerHTML = 'Carregando...';
    const { data } = await sb.rpc('get_farms');
    elsMap.farmList.innerHTML = '';
    
    currentLayerGroup.clearLayers();
    const bounds = L.latLngBounds([USINA_COORDS]); // Começa limites na Usina

    if(data && data.length > 0) {
        data.forEach(f => {
            // Lista
            const d = document.createElement('div'); d.className='farm-item';
            d.innerHTML = `<div><small>${f.cod_fazenda||''}</small><br><strong>${f.name}</strong></div><div><button class="btn-icon e"><i class="fa-solid fa-pen"></i></button><button class="btn-icon v"><i class="fa-solid fa-map"></i></button></div>`;
            d.querySelector('.e').onclick = () => editFarm(f);
            d.querySelector('.v').onclick = () => viewFarm(f);
            elsMap.farmList.appendChild(d);

            // Mapa (Visão Geral)
            const feats = f.geojson.features || [f.geojson];
            feats.forEach(ft => {
                const res = createLayerFromFeature(ft, true);
                if(res) { 
                    currentLayerGroup.addLayer(res.layer); 
                    if(res.layer.getBounds().isValid()) bounds.extend(res.layer.getBounds());
                }
            });
        });
        // Zoom para caber todas as fazendas + usina
        map.fitBounds(bounds, { padding: [50, 50] });
    } else {
        elsMap.farmList.innerHTML = 'Vazio';
        map.setView(USINA_COORDS, 13);
    }
}

function viewFarm(f) {
    // Foca numa fazenda específica sem limpar as outras (apenas zoom)
    const tempGroup = L.featureGroup();
    const feats = f.geojson.features || [f.geojson];
    feats.forEach(ft => tempGroup.addLayer(L.geoJSON(ft)));
    map.fitBounds(tempGroup.getBounds());
}

function editFarm(f) {
    // Entra modo edição
    currentLayerGroup.clearLayers(); currentFeaturesData = [];
    editingFarmId = f.id;
    elsMap.inputCod.value = f.cod_fazenda; elsMap.inputName.value = f.name; elsMap.inputOwner.value = f.owner;
    elsMap.btnOpenSave.innerHTML = 'Atualizar';
    if(elsMap.btnCancel) elsMap.btnCancel.classList.remove('hidden');
    
    const feats = f.geojson.features || [f.geojson];
    feats.forEach(ft => {
        const res = createLayerFromFeature(ft, false); // false = Editável
        if(res) { 
            currentLayerGroup.addLayer(res.layer); 
            currentFeaturesData.push({ layerId: res.layerId, feature: res.feature, layerInstance: res.layer }); 
        }
    });
    map.fitBounds(currentLayerGroup.getBounds());
}

// Util
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid fa-info-circle"></i> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}
document.getElementById('btn-close-modal').onclick = () => document.getElementById('modal-overlay').classList.add('hidden');

// Init
loadFarms();
loadOwnersForSelect();