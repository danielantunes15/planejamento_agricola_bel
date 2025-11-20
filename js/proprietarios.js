// js/proprietarios.js - Módulo de Proprietários

window.loadOwnersList = async function() {
    const tbody = document.getElementById('owner-list-body');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Carregando...</td></tr>';
    
    const { data, error } = await sb.rpc('get_fornecedores');
    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:red">Erro: ${error.message}</td></tr>`;
        return;
    }
    tbody.innerHTML = '';
    if(!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#777;">Nenhum cadastrado.</td></tr>';
        return;
    }

    data.forEach(o => {
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
};

window.saveOwner = async function() {
    const id = document.getElementById('owner-id').value;
    const p = {
        p_cod: document.getElementById('owner-cod').value,
        p_nome: document.getElementById('owner-name').value,
        p_cpf: document.getElementById('owner-cpf').value,
        p_tel: document.getElementById('owner-tel').value
    };

    if(!p.p_nome) return showToast('Nome obrigatório.', 'error');
    showToast('Salvando...', 'info');
    
    let result;
    if(id) { p.p_id = id; result = await sb.rpc('update_fornecedor', p); } 
    else { result = await sb.rpc('insert_fornecedor', p); }
    
    if(result.error) showToast('Erro: ' + result.error.message, 'error');
    else { showToast('Salvo com sucesso!'); clearOwnerForm(); loadOwnersList(); }
};

window.editOwner = function(o) {
    document.getElementById('owner-id').value = o.id;
    document.getElementById('owner-cod').value = o.cod_fornecedor || '';
    document.getElementById('owner-name').value = o.nome || '';
    document.getElementById('owner-cpf').value = o.cpf_cnpj || '';
    document.getElementById('owner-tel').value = o.telefone || '';
};

window.clearOwnerForm = function() {
    document.getElementById('owner-id').value = '';
    document.querySelectorAll('#view-proprietarios input').forEach(i => i.value = '');
};

window.delOwner = async function(id) {
    if(confirm('Excluir este fornecedor?')) {
        const { error } = await sb.rpc('delete_fornecedor', {p_id: id});
        if(error) showToast('Erro: ' + error.message, 'error');
        else { showToast('Excluído.'); loadOwnersList(); }
    }
};