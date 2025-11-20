// js/producao.js

window.loadProducaoData = async function() {
    toggleLoader(true);
    
    // 1. Carregar Selects (Fazendas e Frentes) se necessário
    if(document.getElementById('prod-fazenda').options.length <= 1) {
        try {
            const [resFarms, resFrentes] = await Promise.all([
                sb.from('fazendas').select('id, name').order('name'),
                sb.from('frentes').select('id, nome').order('nome')
            ]);
            
            const selFazenda = document.getElementById('prod-fazenda');
            selFazenda.innerHTML = '<option value="">Selecione...</option>';
            if(resFarms.data) resFarms.data.forEach(f => {
                selFazenda.innerHTML += `<option value="${f.id}">${f.name}</option>`;
            });

            const selFrente = document.getElementById('prod-frente');
            selFrente.innerHTML = '<option value="">Selecione...</option>';
            if(resFrentes.data) resFrentes.data.forEach(f => {
                selFrente.innerHTML += `<option value="${f.id}">${f.nome}</option>`;
            });
        } catch (e) {
            console.error("Erro ao carregar selects", e);
        }
    }

    // 2. Carregar Tabela
    const tbody = document.getElementById('prod-list-body');
    if(tbody) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Carregando...</td></tr>';
        const { data, error } = await sb.rpc('get_producao');
        
        tbody.innerHTML = '';
        if(error) { 
            tbody.innerHTML = `<tr><td colspan="5" style="color:red">Erro: ${error.message}</td></tr>`; 
        } else if(!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#777">Sem registros recentes.</td></tr>';
        } else {
            data.forEach(p => {
                // Formatar data para PT-BR (considerando timezone UTC do banco)
                const dateParts = p.data_producao.split('-'); // YYYY-MM-DD
                const dateStr = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

                tbody.innerHTML += `
                    <tr>
                        <td>${dateStr}</td>
                        <td>${p.nome_fazenda || '-'}</td>
                        <td>${p.nome_frente || '-'}</td>
                        <td><strong>${Number(p.toneladas).toFixed(2)}</strong></td>
                        <td>
                            <button class="btn-icon" style="color:#ef4444" onclick="delProducao(${p.id})" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>`;
            });
        }
    }
    toggleLoader(false);
};

window.saveProducao = async function() {
    const dados = {
        data_producao: document.getElementById('prod-data').value,
        id_fazenda: document.getElementById('prod-fazenda').value,
        id_frente: document.getElementById('prod-frente').value || null,
        toneladas: document.getElementById('prod-ton').value
    };

    if(!dados.data_producao || !dados.id_fazenda || !dados.toneladas) return showToast('Preencha Data, Fazenda e Peso.', 'error');

    toggleLoader(true);
    const { error } = await sb.from('producao').insert(dados);
    
    if(error) showToast('Erro: ' + error.message, 'error');
    else {
        showToast('Produção lançada com sucesso!');
        clearProducaoForm();
        loadProducaoData();
    }
    toggleLoader(false);
};

window.delProducao = async function(id) {
    if(confirm('Deseja realmente excluir este registro?')) {
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
    // Não limpa a data nem a frente para facilitar digitação sequencial
};