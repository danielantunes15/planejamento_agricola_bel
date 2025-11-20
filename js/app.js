// js/app.js

// 1. SETUP GLOBAL
if (typeof APP_CONFIG === 'undefined') alert('ERRO: config.js não encontrado.');
const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

if (typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:32724", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs");
}
const USINA_COORDS = [-17.643763707243053, -40.18234136873469];

// Paleta de Cores Neon
const TOP_5_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6'];
const OTHER_COLOR = '#64748b';

// UX: Loading Overlay
window.toggleLoader = function(show) {
    const overlay = document.getElementById('loading-overlay');
    if(show) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
};

window.showToast = function(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid fa-info-circle"></i> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
};

// 2. NAVEGAÇÃO
window.switchView = function(viewId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-btn[onclick="switchView('${viewId}')"]`);
    if(activeBtn) {
        activeBtn.classList.add('active');
        const parentGroup = activeBtn.closest('.nav-group-dropdown');
        if(parentGroup) parentGroup.classList.add('open');
    }

    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(`view-${viewId}`);
    if(view) view.classList.add('active');

    // Hooks de carregamento para cada aba
    if(viewId === 'dashboard') {
        loadDashboardData();
        if(mapDash) {
            mapDash.invalidateSize();
            setTimeout(() => mapDash.invalidateSize(), 400);
        }
    }
    if(viewId === 'lista-fazendas') if(typeof loadFarmsTable === 'function') loadFarmsTable();
    if(viewId === 'fazendas') {
        if(typeof initFazendasMap === 'function') initFazendasMap(); 
        if(typeof loadOwnersForSelect === 'function') loadOwnersForSelect();
    }
    if(viewId === 'producao') if(typeof loadProducaoData === 'function') loadProducaoData();
    if(viewId === 'proprietarios') if(typeof loadOwnersList === 'function') loadOwnersList();
    if(viewId === 'frentes') if(typeof loadFrontsList === 'function') loadFrontsList();
};

window.toggleSubmenu = function(id) {
    const submenu = document.getElementById(`submenu-${id}`);
    const btn = submenu.previousElementSibling; 
    const parent = btn.parentElement;
    if(submenu.classList.contains('open')) {
        submenu.classList.remove('open');
        parent.classList.remove('open');
    } else {
        document.querySelectorAll('.submenu-container').forEach(s => { s.classList.remove('open'); s.parentElement.classList.remove('open'); });
        submenu.classList.add('open');
        parent.classList.add('open');
    }
};

// 3. DASHBOARD CONTROLLER
let mapDash = null;
let layerGroupDash = null;

async function loadDashboardData() {
    if(!mapDash) {
        const satDark = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 21, className: 'map-sat-dark' });
        const roadsBlack = L.tileLayer('https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}', { maxZoom: 21, className: 'map-roads-black', pane: 'shadowPane' });
        const darkModeGroup = L.layerGroup([satDark, roadsBlack]);
        const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 21, attribution: 'Google' });
        const googleStreets = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 21, attribution: 'Google' });

        mapDash = L.map('map-dashboard', { 
            center: USINA_COORDS, zoom: 13, zoomControl: false, layers: [darkModeGroup] 
        });
        L.control.zoom({ position: 'topright' }).addTo(mapDash);
        L.control.layers({ "Modo Escuro": darkModeGroup, "Satélite": googleHybrid, "Mapa": googleStreets }).addTo(mapDash);

        const usinaIcon = L.divIcon({
            html: '<i class="fa-solid fa-industry" style="color: #fff; font-size: 26px; text-shadow: 0 2px 5px black;"></i>',
            className: 'custom-div-icon', iconSize: [30, 30], iconAnchor: [15, 15]
        });
        L.marker(USINA_COORDS, { icon: usinaIcon }).addTo(mapDash).bindPopup("<strong>USINA BEL</strong>");
        layerGroupDash = L.featureGroup().addTo(mapDash);

        mapDash.on('zoomend', () => {
            const div = document.getElementById('map-dashboard');
            if(mapDash.getZoom() < 14) div.classList.add('hide-labels');
            else div.classList.remove('hide-labels');
        });
    }
    setTimeout(() => mapDash.invalidateSize(), 200);

    // Dados
    const listEl = document.getElementById('dash-top5-list');
    const totalEl = document.getElementById('dash-total-area');
    
    const { data, error } = await sb.rpc('get_farms'); // Use RPC otimizada ou select normal
    if(error || !data) { listEl.innerHTML = '<li>Erro ao carregar dados.</li>'; return; }

    // Cálculo Estatístico
    let totalArea = 0;
    let ownerStats = {};

    data.forEach(f => {
        const area = Number(f.area_ha || 0);
        totalArea += area;
        const owner = f.owner || 'Não Definido';
        if(!ownerStats[owner]) ownerStats[owner] = 0;
        ownerStats[owner] += area;
    });

    let sortedOwners = Object.keys(ownerStats).map(k => ({ name: k, area: ownerStats[k] })).sort((a, b) => b.area - a.area);
    const top5 = sortedOwners.slice(0, 5);
    const others = sortedOwners.slice(5);
    const othersArea = others.reduce((acc, curr) => acc + curr.area, 0);

    const ownerColors = {};
    top5.forEach((item, index) => ownerColors[item.name] = TOP_5_COLORS[index]);

    // Desenhar Mapa
    layerGroupDash.clearLayers();
    let bounds = L.latLngBounds([USINA_COORDS]);

    data.forEach(f => {
        const owner = f.owner || 'Não Definido';
        const color = ownerColors[owner] ? ownerColors[owner] : OTHER_COLOR;
        const opacity = ownerColors[owner] ? 0.6 : 0.3;
        const weight = ownerColors[owner] ? 2 : 1;

        const feats = f.geojson.features || [f.geojson];
        feats.forEach(ft => {
             // INJETAR PROPRIETÁRIO PARA FILTRAGEM
             ft.properties.owner = owner;
             
             const layer = L.geoJSON(ft, { 
                 style: { color: color, weight: weight, fillColor: color, fillOpacity: opacity } 
             });
             
             let labelName = (ft.properties.talhao || '').replace(/Talhão\s*|T-/yi, '').trim();
             layer.bindTooltip(
                 `<span style="font-weight:900; text-shadow: 0 0 3px #000;">${labelName}</span>`, 
                 { direction:'center', className: 'talhao-label', permanent: true }
             );
             layerGroupDash.addLayer(layer);
             if(layer.getBounds().isValid()) bounds.extend(layer.getBounds());
        });
    });
    if(data.length > 0) mapDash.fitBounds(bounds, { padding: [50, 50] });

    // Preencher Lista Lateral
    totalEl.innerText = totalArea.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + " ha";
    listEl.innerHTML = '';
    const maxArea = top5.length > 0 ? top5[0].area : 1;

    top5.forEach((item, index) => {
        const percent = (item.area / maxArea) * 100;
        const color = TOP_5_COLORS[index];
        
        // ADICIONADO ONCLICK FILTER
        listEl.innerHTML += `
            <li style="cursor:pointer;" onclick="filterDashboardMap('${item.name}')" title="Clique para focar em ${item.name}">
                <div class="top5-header">
                    <span class="top5-name">
                        <span class="legend-dot" style="background:${color}"></span>
                        ${index+1}. ${item.name}
                    </span>
                    <span class="top5-val">${item.area.toFixed(2)} ha</span>
                </div>
                <div class="top5-bar-bg">
                    <div class="top5-bar-fill" style="width:${percent}%; background:${color}"></div>
                </div>
            </li>`;
    });

    if(others.length > 0) {
         listEl.innerHTML += `
            <li style="margin-top:10px; border-top:1px dashed #444; padding-top:8px; cursor:pointer" onclick="filterDashboardMap(null)">
                <div class="top5-header">
                    <span class="top5-name">
                        <span class="legend-dot" style="background:${OTHER_COLOR}"></span>
                        Outros (${others.length})
                    </span>
                    <span class="top5-val">${othersArea.toFixed(2)} ha</span>
                </div>
                <div class="top5-bar-bg">
                    <div class="top5-bar-fill" style="width: ${(othersArea/totalArea)*100}%; background: ${OTHER_COLOR}"></div>
                </div>
            </li>`;
    }
}

// Filtro Interativo do Dashboard
window.filterDashboardMap = function(ownerName) {
    if(!layerGroupDash) return;
    layerGroupDash.eachLayer(layer => {
        // O Leaflet agrupa Features em Layers. Precisamos pegar a feature original se possível ou iterar layers internas
        // Simplificação: assumindo que a layer adicionada no grupo é o GeoJSON direto
        // Se for GeometryCollection pode ser complexo, mas para Poligonos simples funciona
        
        // Hack: recuperar propriedade da primeira layer interna se for grupo, ou da própria layer
        let featOwner = null;
        if(layer.feature && layer.feature.properties) featOwner = layer.feature.properties.owner;
        else if(layer.getLayers && layer.getLayers().length > 0) featOwner = layer.getLayers()[0].feature.properties.owner;

        if(!ownerName || featOwner === ownerName) {
            layer.setStyle({ fillOpacity: 0.6, opacity: 1, weight: 2 });
            if(featOwner === ownerName) layer.bringToFront();
        } else {
            layer.setStyle({ fillOpacity: 0.1, opacity: 0.1, weight: 0 });
        }
    });
    showToast(ownerName ? `Filtrado: ${ownerName}` : 'Filtro Limpo');
};

document.getElementById('btn-close-modal').onclick = () => document.getElementById('modal-overlay').classList.add('hidden');
window.addEventListener('resize', () => { if(mapDash) mapDash.invalidateSize(); });

// Inicializa
loadDashboardData();