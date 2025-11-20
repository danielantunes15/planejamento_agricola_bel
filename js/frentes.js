// js/frentes.js

window.loadFrontsList = async function() {
    const tbody = document.getElementById('front-list-body');
    if(!tbody) return;
    toggleLoader(true);
    
    const { data, error } = await sb.rpc('get_frentes');
    if (error) {
        tbody.innerHTML = `<tr><td colspan="3">Erro: ${error.message}</td></tr>`;
        toggleLoader(false);
        return;
    }
    tbody.innerHTML = '';
    if(!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#777;">Nenhuma frente.</td></tr>';
    } else {
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
    toggleLoader(false);
};

window.saveFront = async function() {
    const id = document.getElementById('front-id').value;
    const p = {
        p_cod: document.getElementById('front-cod').value,
        p_nome: document.getElementById('front-name').value
    };
    if(!p.p_nome) return showToast('Nome obrigatório.', 'error');
    
    toggleLoader(true);
    let result;
    if(id) { p.p_id = id; result = await sb.rpc('update_frente', p); } 
    else { result = await sb.rpc('insert_frente', p); }
    
    if(result.error) showToast('Erro: ' + result.error.message, 'error');
    else { showToast('Salvo!'); clearFrontForm(); loadFrontsList(); }
    toggleLoader(false);
};

window.editFront = function(f) {
    document.getElementById('front-id').value = f.id;
    document.getElementById('front-cod').value = f.cod_frente || '';
    document.getElementById('front-name').value = f.nome || '';
};

window.clearFrontForm = function() {
    document.getElementById('front-id').value = '';
    document.querySelectorAll('#view-frentes input').forEach(i => i.value = '');
};

window.delFront = async function(id) {
    if(confirm('Excluir esta frente?')) {
        toggleLoader(true);
        const { error } = await sb.rpc('delete_frente', {p_id: id});
        if(error) showToast('Erro: ' + error.message, 'error');
        else loadFrontsList();
        toggleLoader(false);
    }
};