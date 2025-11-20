// js/app.js - Lógica Global e Dashboard

// 1. SETUP GLOBAL
if (typeof APP_CONFIG === 'undefined') alert('ERRO: config.js não encontrado.');
const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

// Projeção Global
if (typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:32724", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs");
}
const USINA_COORDS = [-17.643763707243053, -40.18234136873469];

// 2. NAVEGAÇÃO & SUBMENUS
window.switchView = function(viewId) {
    // Remove 'active' de todos os botões normais e sub-botões
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    // Adiciona active no botão clicado
    const activeBtn = document.querySelector(`.nav-btn[onclick="switchView('${viewId}')"]`);
    if(activeBtn) {
        activeBtn.classList.add('active');
        // Se for um botão de submenu, garante que o pai esteja aberto visualmente (opcional)
        const parentGroup = activeBtn.closest('.nav-group-dropdown');
        if(parentGroup) parentGroup.classList.add('open');
    }

    // Troca Telas
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(`view-${viewId}`);
    if(view) view.classList.add('active');

    // Triggers Específicos
    if(viewId === 'dashboard') {
        setTimeout(() => { if(mapDash) mapDash.invalidateSize(); }, 200);
        loadDashboardData();
    }
    if(viewId === 'fazendas') {
        // Função que estará no fazendas.js
        if(typeof initFazendasMap === 'function') initFazendasMap(); 
        if(typeof loadOwnersForSelect === 'function') loadOwnersForSelect();
    }
    if(viewId === 'proprietarios') {
        if(typeof loadOwnersList === 'function') loadOwnersList();
    }
    if(viewId === 'frentes') {
        if(typeof loadFrontsList === 'function') loadFrontsList();
    }
};

window.toggleSubmenu = function(id) {
    const submenu = document.getElementById(`submenu-${id}`);
    const btn = submenu.previousElementSibling; 
    const parent = btn.parentElement;

    if(submenu.classList.contains('open')) {
        submenu.classList.remove('open');
        parent.classList.remove('open');
    } else {
        // Fecha outros se quiser comportamento de acordeão único
        document.querySelectorAll('.submenu-container').forEach(s => {
            s.classList.remove('open');
            s.parentElement.classList.remove('open');
        });
        submenu.classList.add('open');
        parent.classList.add('open');
    }
};

// 3. DASHBOARD CONTROLLER
let mapDash = null;
let layerGroupDash = null;

async function loadDashboardData() {
    if(!mapDash) {
        const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 21, subdomains: ['mt0','mt1','mt2','mt3'] });
        mapDash = L.map('map-dashboard', { center: USINA_COORDS, zoom: 13, zoomControl: false, layers: [googleSat] });
        L.control.zoom({ position: 'topright' }).addTo(mapDash);
        
        // Ícone Usina
        const usinaIcon = L.divIcon({
            html: '<i class="fa-solid fa-industry" style="color: #fff; font-size: 26px; text-shadow: 0 2px 5px black;"></i>',
            className: 'custom-div-icon', iconSize: [30, 30], iconAnchor: [15, 15]
        });
        L.marker(USINA_COORDS, { icon: usinaIcon }).addTo(mapDash).bindPopup("<strong>USINA BEL</strong>");
        layerGroupDash = L.featureGroup().addTo(mapDash);
    }

    const listEl = document.getElementById('dash-top5-list');
    const totalEl = document.getElementById('dash-total-area');
    
    const { data, error } = await sb.rpc('get_farms');
    if(error || !data) { listEl.innerHTML = '<li>Erro ao carregar dados.</li>'; return; }

    layerGroupDash.clearLayers();
    let bounds = L.latLngBounds([USINA_COORDS]);
    let totalArea = 0;
    let ownerStats = {};

    data.forEach(f => {
        const area = Number(f.area_ha || 0);
        totalArea += area;
        const owner = f.owner || 'Não Definido';
        if(!ownerStats[owner]) ownerStats[owner] = 0;
        ownerStats[owner] += area;

        // Desenha no mapa (simplificado)
        const feats = f.geojson.features || [f.geojson];
        feats.forEach(ft => {
             const layer = L.geoJSON(ft, { style: { color: '#10b981', weight: 1, fillOpacity: 0.4 } });
             let labelName = (ft.properties.talhao || '').replace(/Talhão\s*|T-/yi, '').trim();
             layer.bindTooltip(`${labelName}`, { direction:'center', className: 'talhao-label', permanent: false });
             layerGroupDash.addLayer(layer);
             if(layer.getBounds().isValid()) bounds.extend(layer.getBounds());
        });
    });

    if(data.length > 0) mapDash.fitBounds(bounds, { padding: [50, 50] });

    // TOP 5 Lógica
    let sortedOwners = Object.keys(ownerStats).map(k => ({ name: k, area: ownerStats[k] })).sort((a, b) => b.area - a.area);
    const top5 = sortedOwners.slice(0, 5);
    const others = sortedOwners.slice(5);
    const othersArea = others.reduce((acc, curr) => acc + curr.area, 0);

    totalEl.innerText = totalArea.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + " ha";
    listEl.innerHTML = '';

    const maxArea = top5.length > 0 ? top5[0].area : 1;

    top5.forEach((item, index) => {
        const percent = (item.area / maxArea) * 100;
        listEl.innerHTML += `<li><div style="width:100%"><div style="display:flex; justify-content:space-between;"><span class="top5-name">${index+1}. ${item.name}</span><span class="top5-val">${item.area.toFixed(2)} ha</span></div><div class="top5-bar-bg"><div class="top5-bar-fill" style="width:${percent}%"></div></div></div></li>`;
    });

    if(others.length > 0) {
         listEl.innerHTML += `<li style="margin-top:10px; border-top:1px dashed #555; padding-top:10px;"><div style="width:100%"><div style="display:flex; justify-content:space-between;"><span class="top5-name">Outros (${others.length})</span><span class="top5-val">${othersArea.toFixed(2)} ha</span></div><div class="top5-bar-bg"><div class="top5-bar-fill" style="width: ${(othersArea/totalArea)*100}%; background: #64748b"></div></div></div></li>`;
    }
}

// 4. UTIL
window.showToast = function(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid fa-info-circle"></i> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}
document.getElementById('btn-close-modal').onclick = () => document.getElementById('modal-overlay').classList.add('hidden');

// Inicialização
loadDashboardData();