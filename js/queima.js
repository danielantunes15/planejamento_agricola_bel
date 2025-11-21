// js/queima.js

window.loadQueimaData = async function() {
    toggleLoader(true);

    // Carregar Fazendas para o Select se vazio
    const selFazenda = document.getElementById('queima-fazenda');
    if(selFazenda && selFazenda.options.length <= 1) {
        // Reusa cache se existir, senão busca
        let farms = window.fazendasCache;
        if(!farms) {
            const { data } = await sb.from('fazendas').select('id, name, geojson').order('name');
            farms = data || [];
            window.fazendasCache = farms;
        }
        selFazenda.innerHTML = '<option value="">Selecione...</option>';
        farms.forEach(f => {
            selFazenda.innerHTML += `<option value="${f.id}">${f.name}</option>`;
        });
    }

    // Carregar Tabela
    const tbody = document.getElementById('queima-list-body');
    if(tbody) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Carregando...</td></tr>';
        
        const { data, error } = await sb
            .from('queima')
            .select(`*, fazendas(name)`)
            .order('data_evento', { ascending: false });

        tbody.innerHTML = '';
        if(error) {
             tbody.innerHTML = `<tr><td colspan="5" style="color:red">Erro: ${error.message}</td></tr>`;
        } else if(!data || data.length === 0) {
             tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Nenhum registro de queima.</td></tr>';
        } else {
             data.forEach(q => {
                 const d = q.data_evento.split('-');
                 const dateStr = `${d[2]}/${d[1]}/${d[0]}`;
                 tbody.innerHTML += `
                    <tr>
                        <td>${dateStr}</td>
                        <td>${q.fazendas?.name || '?'} <small>(${q.talhao || 'Geral'})</small></td>
                        <td>${q.area_queimada_ha} ha</td>
                        <td>${q.causa}</td>
                        <td><button class="btn-icon" style="color:red" onclick="delQueima(${q.id})"><i class="fa-solid fa-trash"></i></button></td>
                    </tr>
                 `;
             });
        }
    }
    toggleLoader(false);
}

window.loadTalhoesForQueima = function() {
    const id = document.getElementById('queima-fazenda').value;
    const selTalhao = document.getElementById('queima-talhao');
    selTalhao.innerHTML = '<option value="">Geral</option>';
    
    if(!id || !window.fazendasCache) return;
    
    const fazenda = window.fazendasCache.find(f => f.id == id);
    if(fazenda && fazenda.geojson) {
        const features = fazenda.geojson.features || [fazenda.geojson];
        features.forEach((ft, idx) => {
            let nome = ft.properties.talhao || `T-${idx+1}`;
            nome = nome.replace(/Talhão\s*/i, '').trim();
            selTalhao.innerHTML += `<option value="${nome}">${nome}</option>`;
        });
    }
}

window.saveQueima = async function() {
    const dados = {
        data_evento: document.getElementById('queima-data').value,
        id_fazenda: document.getElementById('queima-fazenda').value,
        talhao: document.getElementById('queima-talhao').value,
        area_queimada_ha: document.getElementById('queima-area').value,
        causa: document.getElementById('queima-causa').value
    };

    if(!dados.data_evento || !dados.id_fazenda || !dados.area_queimada_ha) 
        return showToast('Preencha Data, Fazenda e Área.', 'error');

    toggleLoader(true);
    const { error } = await sb.from('queima').insert(dados);
    if(error) showToast('Erro: ' + error.message, 'error');
    else {
        showToast('Incêndio registrado.');
        document.getElementById('queima-area').value = '';
        loadQueimaData();
    }
    toggleLoader(false);
}

window.delQueima = async function(id) {
    if(confirm('Excluir registro?')) {
        await sb.from('queima').delete().eq('id', id);
        loadQueimaData();
    }
}

window.clearQueimaForm = function() {
    document.querySelectorAll('#view-queima input').forEach(i => i.value='');
    document.getElementById('queima-fazenda').value='';
    document.getElementById('queima-talhao').innerHTML='<option value="">Geral</option>';
}