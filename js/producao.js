// js/producao.js

window.loadProducaoData = async function() {
    toggleLoader(true);
    
    // Carregar Selects (Fazendas e Frentes)
    const selFazenda = document.getElementById('prod-fazenda');
    if(selFazenda && selFazenda.options.length <= 1) {
        const [resFarms, resFrentes] = await Promise.all([
            sb.from('fazendas').select('id, name, geojson').order('name'),
            sb.from('frentes').select('id, nome').order('nome')
        ]);
        
        // Cachear GeoJSONs para extrair talhões
        window.fazendasCache = resFarms.data || [];
        
        selFazenda.innerHTML = '<option value="">Selecione...</option>';
        if(resFarms.data) resFarms.data.forEach(f => {
            selFazenda.innerHTML += `<option value="${f.id}">${f.name}</option>`;
        });

        const selFrente = document.getElementById('prod-frente');
        selFrente.innerHTML = '<option value="">Selecione...</option>';
        if(resFrentes.data) resFrentes.data.forEach(f => {
            selFrente.innerHTML += `<option value="${f.id}">${f.nome}</option>`;
        });
    }

    // Carregar Tabela
    const tbody = document.getElementById('prod-list-body');
    if(tbody) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Carregando...</td></tr>';
        
        // Join manual ou View no Supabase seria melhor, mas aqui faremos fetch simples
        const { data, error } = await sb
            .from('producao')
            .select(`
                id, data_producao, toneladas, safra, talhao,
                fazendas (name),
                frentes (nome)
            `)
            .order('data_producao', { ascending: false })
            .limit(50);
        
        tbody.innerHTML = '';
        if(error) { 
            tbody.innerHTML = `<tr><td colspan="5" style="color:red">Erro: ${error.message}</td></tr>`; 
        } else if(!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#777">Sem registros.</td></tr>';
        } else {
            data.forEach(p => {
                const dateParts = p.data_producao.split('-'); 
                const dateStr = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
                const fazendaNome = p.fazendas ? p.fazendas.name : 'N/A';
                const frenteNome = p.frentes ? p.frentes.nome : '-';
                const talhao = p.talhao || 'Geral';

                tbody.innerHTML += `
                    <tr>
                        <td>${dateStr}</td>
                        <td>${p.safra || '-'}</td>
                        <td>${fazendaNome} <small style="color:#aaa">(${talhao})</small></td>
                        <td><strong>${Number(p.toneladas).toFixed(2)}</strong></td>
                        <td>
                            <button class="btn-icon" style="color:#ef4444" onclick="delProducao(${p.id})"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>`;
            });
        }
    }
    toggleLoader(false);
};

// Carrega Talhões quando seleciona Fazenda
window.loadTalhoesForProduction = function() {
    const id = document.getElementById('prod-fazenda').value;
    const selTalhao = document.getElementById('prod-talhao');
    selTalhao.innerHTML = '<option value="">Geral (Fazenda Toda)</option>';
    
    if(!id || !window.fazendasCache) return;
    
    const fazenda = window.fazendasCache.find(f => f.id == id);
    if(fazenda && fazenda.geojson) {
        const features = fazenda.geojson.features || [fazenda.geojson];
        features.forEach((ft, idx) => {
            let nome = ft.properties.talhao || ft.properties.name || `T-${idx+1}`;
            // Limpeza
            nome = nome.replace(/Talhão\s*/i, '').trim();
            selTalhao.innerHTML += `<option value="${nome}">${nome}</option>`;
        });
    }
};

window.saveProducao = async function() {
    const dados = {
        data_producao: document.getElementById('prod-data').value,
        safra: document.getElementById('prod-safra').value,
        id_fazenda: document.getElementById('prod-fazenda').value,
        talhao: document.getElementById('prod-talhao').value || null,
        id_frente: document.getElementById('prod-frente').value || null,
        toneladas: document.getElementById('prod-ton').value
    };

    if(!dados.data_producao || !dados.id_fazenda || !dados.toneladas || !dados.safra) 
        return showToast('Preencha Data, Safra, Fazenda e Peso.', 'error');

    toggleLoader(true);
    const { error } = await sb.from('producao').insert(dados);
    
    if(error) showToast('Erro: ' + error.message, 'error');
    else {
        showToast('Produção lançada!');
        document.getElementById('prod-ton').value = '';
        loadProducaoData();
    }
    toggleLoader(false);
};

window.delProducao = async function(id) {
    if(confirm('Excluir este registro?')) {
        toggleLoader(true);
        const { error } = await sb.from('producao').delete().eq('id', id);
        if(error) showToast('Erro: ' + error.message, 'error');
        else loadProducaoData();
        toggleLoader(false);
    }
};

window.clearProducaoForm = function() {
    document.getElementById('prod-id').value = '';
    document.getElementById('prod-ton').value = '';
    document.getElementById('prod-fazenda').value = '';
    document.getElementById('prod-talhao').innerHTML = '<option value="">Geral</option>';
};