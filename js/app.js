// js/app.js

// 1. SETUP GLOBAL
if (typeof APP_CONFIG === 'undefined') alert('ERRO: config.js não encontrado.');
const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

if (typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:32724", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs");
}
const USINA_COORDS = [-17.643763707243053, -40.18234136873469];

// Paleta de Cores (Cores mais vivas para contraste com satélite)
const TOP_5_COLORS = ['#00ff7f', '#00bfff', '#ffd700', '#ff1493', '#9370db']; // SpringGreen, DeepSkyBlue, Gold, DeepPink, MediumPurple
const OTHER_COLOR = '#a9a9a9'; // DarkGray

// Variáveis Globais
let dashboardChart = null;
let currentMapMode = 'owners'; // 'owners' ou 'productivity'

// --- UX & HELPERS ---
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

// --- NAVEGAÇÃO ---
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

    if(viewId === 'dashboard') {
        loadDashboardData();
        fetchWeather();
    }
    if(viewId === 'lista-fazendas') if(typeof loadFarmsTable === 'function') loadFarmsTable();
    if(viewId === 'fazendas') {
        if(typeof initFazendasMap === 'function') initFazendasMap(); 
        if(typeof loadOwnersForSelect === 'function') loadOwnersForSelect();
    }
    if(viewId === 'producao') if(typeof loadProducaoData === 'function') loadProducaoData();
    if(viewId === 'queima') if(typeof loadQueimaData === 'function') loadQueimaData();
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
        document.querySelectorAll('.submenu-container').forEach(s => { 
            s.classList.remove('open'); 
            s.parentElement.classList.remove('open'); 
        });
        submenu.classList.add('open');
        parent.classList.add('open');
    }
};

// --- DASHBOARD ---
let mapDash = null;
let layerGroupDash = null;

async function loadDashboardData() {
    if(!mapDash) {
        const satDark = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 21, className: 'map-sat-dark' });
        const roadsBlack = L.tileLayer('https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}', { maxZoom: 21, className: 'map-roads-black', pane: 'shadowPane' });
        const darkModeGroup = L.layerGroup([satDark, roadsBlack]);
        const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 21, attribution: 'Google' });

        mapDash = L.map('map-dashboard', { 
            center: USINA_COORDS, zoom: 13, zoomControl: false, layers: [darkModeGroup] 
        });
        L.control.zoom({ position: 'topright' }).addTo(mapDash);
        L.control.layers({ "Modo Escuro": darkModeGroup, "Satélite": googleHybrid }).addTo(mapDash);
        layerGroupDash = L.featureGroup().addTo(mapDash);

        const updateLabels = () => {
            const div = document.getElementById('map-dashboard');
            if(mapDash.getZoom() < 15) div.classList.add('hide-labels');
            else div.classList.remove('hide-labels');
        };
        mapDash.on('zoomend', updateLabels);
        updateLabels();
    }
    setTimeout(() => mapDash.invalidateSize(), 200);

    const { data: farms } = await sb.from('fazendas').select('*');
    if(!farms) return;

    // Estatísticas
    let totalArea = 0;
    let ownerStats = {};

    farms.forEach(f => {
        const area = Number(f.area_ha || 0);
        totalArea += area;
        const owner = f.owner || 'Não Definido';
        if(!ownerStats[owner]) ownerStats[owner] = 0;
        ownerStats[owner] += area;
    });

    let sortedOwners = Object.keys(ownerStats)
        .map(k => ({ name: k, area: ownerStats[k] }))
        .sort((a, b) => b.area - a.area);
    
    const top5 = sortedOwners.slice(0, 5);
    const others = sortedOwners.slice(5);
    const othersArea = others.reduce((acc, curr) => acc + curr.area, 0);

    const ownerColors = {};
    top5.forEach((item, index) => ownerColors[item.name] = TOP_5_COLORS[index]);

    // Desenha Mapa
    layerGroupDash.clearLayers();
    let bounds = L.latLngBounds([USINA_COORDS]);

    farms.forEach(f => {
        const owner = f.owner || 'Não Definido';
        let color = OTHER_COLOR;
        
        if(currentMapMode === 'owners') {
            if(ownerColors[owner]) color = ownerColors[owner];
        } else {
            color = Math.random() > 0.5 ? '#10b981' : '#ef4444';
        }

        const feats = f.geojson.features || [f.geojson];
        feats.forEach(ft => {
             ft.properties.owner = owner;
             
             // --- CORREÇÃO AQUI: Contorno da MESMA cor do preenchimento ---
             const layer = L.geoJSON(ft, { 
                 style: { 
                     color: color,      // Contorno da mesma cor
                     weight: 2,         // Espessura média
                     opacity: 1,        // Contorno sólido (sem transparência)
                     fillColor: color,  // Preenchimento da mesma cor
                     fillOpacity: 0.4   // Preenchimento suave para ver o solo
                 } 
             });
             
             const labelName = (ft.properties.talhao || 'T-?').replace(/Talhão\s*/i,'');
             layer.bindTooltip(labelName, { 
                 direction:'center', className:'talhao-label', permanent: true 
             });
             
             layerGroupDash.addLayer(layer);
             if(layer.getBounds().isValid()) bounds.extend(layer.getBounds());
        });
    });
    
    if(farms.length > 0) mapDash.fitBounds(bounds, { padding: [50, 50] });

    // Atualiza Lista
    const listEl = document.getElementById('dash-top5-list');
    const totalEl = document.getElementById('dash-total-area');

    totalEl.innerText = totalArea.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + " ha";
    listEl.innerHTML = '';
    const maxArea = top5.length > 0 ? top5[0].area : 1;

    top5.forEach((item, index) => {
        const percent = (item.area / maxArea) * 100;
        const color = TOP_5_COLORS[index];
        listEl.innerHTML += `
            <li onclick="filterDashboardMap('${item.name}')" style="cursor:pointer" title="Filtrar por ${item.name}">
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
           <li onclick="filterDashboardMap(null)" style="cursor:pointer; margin-top:10px; border-top:1px dashed #444; padding-top:8px;">
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

    renderChart();
}

async function renderChart() {
    const ctx = document.getElementById('chart-producao');
    if(!ctx) return;
    const { data } = await sb.from('producao').select('toneladas, data_producao');
    let monthlyData = Array(12).fill(0);
    if(data) {
        data.forEach(d => {
            if(d.data_producao) {
                const parts = d.data_producao.split('-');
                const month = parseInt(parts[1]) - 1; 
                if(month >= 0 && month <= 11) monthlyData[month] += Number(d.toneladas);
            }
        });
    }

    if(dashboardChart) dashboardChart.destroy();
    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],
            datasets: [{
                label: 'Produção (Ton)',
                data: monthlyData,
                backgroundColor: '#10b981',
                borderRadius: 4,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${Number(c.raw).toFixed(2)} Ton` } } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#334155', drawBorder: false }, ticks: { color: '#94a3b8', font: {size: 10} } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: {size: 10} } }
            }
        }
    });
}

async function fetchWeather() {
    const lat = USINA_COORDS[0];
    const lng = USINA_COORDS[1];
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
        const data = await res.json();
        if(data.current_weather) {
            document.getElementById('weather-temp').innerText = `${data.current_weather.temperature}°C`;
            const code = data.current_weather.weathercode;
            let desc = "Limpo";
            if(code > 3) desc = "Nublado";
            if(code > 45) desc = "Nevoeiro";
            if(code > 50) desc = "Chuva";
            if(code > 95) desc = "Tempestade";
            document.getElementById('weather-desc').innerText = desc;
        }
    } catch(e) { console.error("Erro clima", e); }
}

window.setMapMode = function(mode) {
    currentMapMode = mode;
    document.querySelectorAll('.map-ctrl-btn').forEach(b => b.classList.remove('active'));
    const btn = event.target.closest('.map-ctrl-btn');
    if(btn) btn.classList.add('active');
    loadDashboardData();
};

window.filterDashboardMap = function(ownerName) {
    if(!layerGroupDash) return;
    layerGroupDash.eachLayer(layer => {
        let featOwner = null;
        if(layer.feature && layer.feature.properties) featOwner = layer.feature.properties.owner;
        
        if(!ownerName || featOwner === ownerName) {
            // Destaca usando a cor original da feature (recuperada do style atual ou recalculada)
            // Para simplificar, forçamos opacidade alta
            const currentColor = layer.options.color || '#fff'; 
            layer.setStyle({ fillOpacity: 0.6, opacity: 1, weight: 3, color: currentColor });
            if(featOwner === ownerName) layer.bringToFront();
        } else {
            layer.setStyle({ fillOpacity: 0.1, opacity: 0.1, weight: 0 });
        }
    });
    if(ownerName) showToast(`Filtrado: ${ownerName}`);
    else showToast('Filtro Limpo');
};

document.getElementById('btn-close-modal').onclick = () => document.getElementById('modal-overlay').classList.add('hidden');
window.addEventListener('resize', () => { if(mapDash) mapDash.invalidateSize(); });

loadDashboardData();