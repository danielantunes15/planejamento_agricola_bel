// js/app.js

// 1. SETUP GLOBAL
if (typeof APP_CONFIG === 'undefined') alert('ERRO: config.js não encontrado.');
const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_KEY);

if (typeof proj4 !== 'undefined') {
    proj4.defs("EPSG:32724", "+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs");
}
const USINA_COORDS = [-17.643763707243053, -40.18234136873469];

const TOP_5_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6'];
const OTHER_COLOR = '#64748b';

// Global Vars
let dashboardChart = null;
let currentMapMode = 'owners'; // 'owners' or 'productivity'

// UX
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

// NAVEGAÇÃO
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
    const parent = submenu.previousElementSibling.parentElement;
    if(submenu.classList.contains('open')) {
        submenu.classList.remove('open');
        parent.classList.remove('open');
    } else {
        document.querySelectorAll('.submenu-container').forEach(s => { s.classList.remove('open'); s.parentElement.classList.remove('open'); });
        submenu.classList.add('open');
        parent.classList.add('open');
    }
};

// DASHBOARD
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
    }
    setTimeout(() => mapDash.invalidateSize(), 200);

    const listEl = document.getElementById('dash-top5-list');
    const totalEl = document.getElementById('dash-total-area');
    
    // Carregar Fazendas
    const { data: farms } = await sb.from('fazendas').select('*');
    if(!farms) return;

    let totalArea = 0;
    let ownerStats = {};

    // Preparar dados e mapa
    layerGroupDash.clearLayers();
    let bounds = L.latLngBounds([USINA_COORDS]);

    farms.forEach(f => {
        totalArea += Number(f.area_ha || 0);
        const owner = f.owner || 'Não Definido';
        if(!ownerStats[owner]) ownerStats[owner] = 0;
        ownerStats[owner] += Number(f.area_ha || 0);

        // Mapa
        const feats = f.geojson.features || [f.geojson];
        feats.forEach(ft => {
             ft.properties.owner = owner;
             // Lógica de Cor
             let color = OTHER_COLOR;
             if(currentMapMode === 'owners') {
                 // Simplificado: cor fixa ou aleatória, aqui usando Other por padrão se não estiver no Top 5
                 // Para ficar perfeito, precisaria recalcular o Top 5 antes de desenhar
             } else {
                 // Modo Produtividade (Mockup - futuramente conectar com tabela producao)
                 // Aqui vamos simular: talhões aleatórios verdes ou vermelhos
                 color = Math.random() > 0.5 ? '#10b981' : '#ef4444'; 
             }
             
             const layer = L.geoJSON(ft, { 
                 style: { color: '#fff', weight: 1, fillColor: color, fillOpacity: 0.5 } 
             });
             layer.bindTooltip(ft.properties.talhao || 'Talhão', { direction:'center', className:'talhao-label', permanent: true });
             layerGroupDash.addLayer(layer);
             if(layer.getBounds().isValid()) bounds.extend(layer.getBounds());
        });
    });
    
    if(farms.length > 0) mapDash.fitBounds(bounds, { padding: [50, 50] });

    // Ordenar Top 5
    let sortedOwners = Object.keys(ownerStats).map(k => ({ name: k, area: ownerStats[k] })).sort((a, b) => b.area - a.area);
    const top5 = sortedOwners.slice(0, 5);
    const others = sortedOwners.slice(5);

    // Colorir Mapa (Owner Mode)
    if(currentMapMode === 'owners') {
        const ownerColors = {};
        top5.forEach((item, index) => ownerColors[item.name] = TOP_5_COLORS[index]);
        layerGroupDash.eachLayer(layer => {
            // Tentativa de recuperar owner da feature
            // O Leaflet encapsula. Precisamos navegar.
            // Simplificação: apenas redesenhar
            // Para produção real, melhor fazer loop duplo: calcula stats -> define cores -> desenha mapa.
            // Aqui vamos apenas atualizar a lista lateral por enquanto.
        });
        
        // Redesenhar mapa com cores corretas
        layerGroupDash.clearLayers();
        farms.forEach(f => {
            const owner = f.owner || 'ND';
            let color = ownerColors[owner] || OTHER_COLOR;
            const feats = f.geojson.features || [f.geojson];
            feats.forEach(ft => {
                const layer = L.geoJSON(ft, { style: { color: color, weight: 1, fillColor: color, fillOpacity: 0.6 } });
                layer.bindTooltip((ft.properties.talhao || '').replace(/Talhão\s*/i,''), {direction:'center', className:'talhao-label', permanent:true});
                layerGroupDash.addLayer(layer);
            });
        });
    }

    // Atualizar UI Lista
    totalEl.innerText = totalArea.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + " ha";
    listEl.innerHTML = '';
    const maxArea = top5.length > 0 ? top5[0].area : 1;
    
    top5.forEach((item, index) => {
        const percent = (item.area / maxArea) * 100;
        const color = TOP_5_COLORS[index];
        listEl.innerHTML += `
            <li onclick="filterDashboardMap('${item.name}')">
                <div class="top5-header"><span class="top5-name"><span class="legend-dot" style="background:${color}"></span>${index+1}. ${item.name}</span><span class="top5-val">${item.area.toFixed(2)} ha</span></div>
                <div class="top5-bar-bg"><div class="top5-bar-fill" style="width:${percent}%; background:${color}"></div></div>
            </li>`;
    });

    // Renderizar Gráfico
    renderChart();
}

async function renderChart() {
    const ctx = document.getElementById('chart-producao');
    if(!ctx) return;
    
    // Dados Mockados ou Reais
    // Ideal: select sum(toneladas) from producao group by month
    const { data } = await sb.from('producao').select('toneladas, data_producao');
    
    let monthlyData = Array(12).fill(0);
    if(data) {
        data.forEach(d => {
            const month = new Date(d.data_producao).getMonth();
            monthlyData[month] += d.toneladas;
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
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

// Clima (Open-Meteo API)
async function fetchWeather() {
    const lat = USINA_COORDS[0];
    const lng = USINA_COORDS[1];
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
        const data = await res.json();
        if(data.current_weather) {
            document.getElementById('weather-temp').innerText = `${data.current_weather.temperature}°C`;
            const code = data.current_weather.weathercode;
            // Simplificado códigos WMO
            let desc = "Limpo";
            if(code > 3) desc = "Nublado";
            if(code > 50) desc = "Chuva";
            if(code > 90) desc = "Tempestade";
            document.getElementById('weather-desc').innerText = desc;
        }
    } catch(e) { console.error("Erro clima", e); }
}

window.setMapMode = function(mode) {
    currentMapMode = mode;
    document.querySelectorAll('.map-ctrl-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    loadDashboardData(); // Recarrega com nova lógica de cores
}

window.filterDashboardMap = function(ownerName) {
    // Implementar filtro visual (opacidade)
    showToast('Filtro: ' + ownerName);
}

document.getElementById('btn-close-modal').onclick = () => document.getElementById('modal-overlay').classList.add('hidden');
window.addEventListener('resize', () => { if(mapDash) mapDash.invalidateSize(); });

// Init
loadDashboardData();