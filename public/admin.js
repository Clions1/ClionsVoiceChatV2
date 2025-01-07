const API_URL = 'http://localhost:3000/api';
const ADMIN_USER_KEY = 'clions_admin_user';

// Sayfa yüklendiğinde admin kontrolü yap
document.addEventListener('DOMContentLoaded', () => {
    checkAdminAuth();
    loadUsers();
    loadServers();

    // Yeni server butonu
    document.getElementById('addServerBtn').addEventListener('click', () => {
        openServerModal();
    });

    // Server kaydet butonu
    document.getElementById('saveServerChanges').addEventListener('click', saveServer);
});

// Admin yetkisi kontrolü
async function checkAdminAuth() {
    const adminUser = localStorage.getItem(ADMIN_USER_KEY);
    if (!adminUser) {
        window.location.href = '/adminlogin.html';
        return;
    }

    const admin = JSON.parse(adminUser);
    document.getElementById('currentUsername').textContent = admin.username;
    loadUsers();
}

// Kullanıcıları listele
async function loadUsers() {
    try {
        const adminUser = localStorage.getItem(ADMIN_USER_KEY);
        if (!adminUser) {
            window.location.href = '/adminlogin.html';
            return;
        }

        const response = await fetch(`${API_URL}/admin/users`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JSON.parse(adminUser).token}`
            }
        });

        const data = await response.json();
        if (data.success) {
            renderUsers(data.users);
        } else {
            throw new Error(data.error || 'Kullanıcılar yüklenirken bir hata oluştu!');
        }
    } catch (error) {
        console.error('Kullanıcı listesi hatası:', error);
        alert('Kullanıcılar yüklenirken bir hata oluştu!');
    }
}

// Kullanıcıları tabloya ekle
function renderUsers(users) {
    const userList = document.getElementById('userList');
    userList.innerHTML = '';

    users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.user_id}</td>
            <td>${user.user_name}</td>
            <td>${user.user_mail}</td>
            <td>${new Date(user.created_at).toLocaleString()}</td>
            <td>
                <button class="btn btn-sm btn-primary edit-user" data-id="${user.user_id}">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-danger delete-user" data-id="${user.user_id}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        userList.appendChild(row);
    });

    // Düzenleme butonları için event listener
    document.querySelectorAll('.edit-user').forEach(button => {
        button.addEventListener('click', () => {
            const userId = button.getAttribute('data-id');
            openEditModal(users.find(u => u.user_id === parseInt(userId)));
        });
    });

    // Silme butonları için event listener
    document.querySelectorAll('.delete-user').forEach(button => {
        button.addEventListener('click', async () => {
            const userId = button.getAttribute('data-id');
            if (confirm('Bu kullanıcıyı silmek istediğinize emin misiniz?')) {
                await deleteUser(userId);
            }
        });
    });
}

// Kullanıcı düzenleme modalını aç
function openEditModal(user) {
    document.getElementById('editUserId').value = user.user_id;
    document.getElementById('editUsername').value = user.user_name;
    document.getElementById('editEmail').value = user.user_mail;
    document.getElementById('editPassword').value = '';

    const modal = new bootstrap.Modal(document.getElementById('editUserModal'));
    modal.show();
}

// Kullanıcı güncelle
async function updateUser(userId, userData) {
    try {
        const adminUser = localStorage.getItem(ADMIN_USER_KEY);
        if (!adminUser) {
            window.location.href = '/adminlogin.html';
            return;
        }

        const response = await fetch(`${API_URL}/admin/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JSON.parse(adminUser).token}`
            },
            body: JSON.stringify(userData)
        });

        const data = await response.json();
        if (data.success) {
            alert('Kullanıcı başarıyla güncellendi!');
            loadUsers();
        } else {
            throw new Error(data.error || 'Güncelleme sırasında bir hata oluştu!');
        }
    } catch (error) {
        console.error('Güncelleme hatası:', error);
        alert('Güncelleme sırasında bir hata oluştu!');
    }
}

// Kullanıcı sil
async function deleteUser(userId) {
    try {
        const adminUser = localStorage.getItem(ADMIN_USER_KEY);
        if (!adminUser) {
            window.location.href = '/adminlogin.html';
            return;
        }

        const response = await fetch(`${API_URL}/admin/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JSON.parse(adminUser).token}`
            }
        });

        const data = await response.json();
        if (data.success) {
            alert('Kullanıcı başarıyla silindi!');
            loadUsers();
        } else {
            throw new Error(data.error || 'Silme işlemi sırasında bir hata oluştu!');
        }
    } catch (error) {
        console.error('Silme hatası:', error);
        alert('Silme işlemi sırasında bir hata oluştu!');
    }
}

// Kullanıcı ara
document.getElementById('searchButton').addEventListener('click', () => {
    const searchTerm = document.getElementById('searchUser').value.toLowerCase();
    const rows = document.querySelectorAll('#userList tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
});

// Değişiklikleri kaydet
document.getElementById('saveUserChanges').addEventListener('click', async () => {
    const userId = document.getElementById('editUserId').value;
    const userData = {
        username: document.getElementById('editUsername').value,
        email: document.getElementById('editEmail').value,
        password: document.getElementById('editPassword').value
    };

    await updateUser(userId, userData);
    const modal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
    modal.hide();
});

// Çıkış yap
document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem(ADMIN_USER_KEY);
    window.location.href = '/adminlogin.html';
});

// Server listesini yükle
async function loadServers() {
    try {
        const adminUser = localStorage.getItem(ADMIN_USER_KEY);
        if (!adminUser) {
            window.location.href = '/adminlogin.html';
            return;
        }

        const response = await fetch(`${API_URL}/admin/servers`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JSON.parse(adminUser).token}`
            }
        });

        const data = await response.json();
        if (data.success) {
            renderServers(data.servers);
        } else {
            throw new Error(data.error || 'Serverler yüklenirken bir hata oluştu!');
        }
    } catch (error) {
        console.error('Server listesi hatası:', error);
        alert('Serverler yüklenirken bir hata oluştu!');
    }
}

// Serverleri tabloya ekle
function renderServers(servers) {
    const serverList = document.getElementById('serverList');
    serverList.innerHTML = '';

    servers.forEach(server => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${server.server_id}</td>
            <td>${server.server_name}</td>
            <td>${server.server_description || '-'}</td>
            <td>${server.max_users}</td>
            <td>
                <span class="badge ${server.is_active ? 'bg-success' : 'bg-danger'}">
                    ${server.is_active ? 'Aktif' : 'Pasif'}
                </span>
            </td>
            <td>${new Date(server.created_at).toLocaleString()}</td>
            <td>
                <button class="btn btn-sm btn-primary edit-server" data-id="${server.server_id}">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-danger delete-server" data-id="${server.server_id}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        serverList.appendChild(row);
    });

    // Düzenleme butonları için event listener
    document.querySelectorAll('.edit-server').forEach(button => {
        button.addEventListener('click', () => {
            const serverId = button.getAttribute('data-id');
            openServerModal(servers.find(s => s.server_id === parseInt(serverId)));
        });
    });

    // Silme butonları için event listener
    document.querySelectorAll('.delete-server').forEach(button => {
        button.addEventListener('click', async () => {
            const serverId = button.getAttribute('data-id');
            if (confirm('Bu serveri silmek istediğinize emin misiniz?')) {
                await deleteServer(serverId);
            }
        });
    });
}

// Server modalını aç
function openServerModal(server = null) {
    const modal = new bootstrap.Modal(document.getElementById('serverModal'));
    const title = document.getElementById('serverModalTitle');
    const form = document.getElementById('serverForm');
    
    // Form alanlarını temizle
    form.reset();
    
    if (server) {
        title.textContent = 'Server Düzenle';
        document.getElementById('serverId').value = server.server_id;
        document.getElementById('serverName').value = server.server_name;
        document.getElementById('serverPassword').value = server.server_password;
        document.getElementById('serverDescription').value = server.server_description || '';
        document.getElementById('maxUsers').value = server.max_users;
        document.getElementById('isActive').checked = server.is_active;
        document.getElementById('serverStatusGroup').style.display = 'block';
    } else {
        title.textContent = 'Yeni Server';
        document.getElementById('serverId').value = '';
        document.getElementById('serverStatusGroup').style.display = 'none';
    }
    
    modal.show();
}

// Server kaydet/güncelle
async function saveServer() {
    const serverId = document.getElementById('serverId').value;
    const serverData = {
        name: document.getElementById('serverName').value,
        password: document.getElementById('serverPassword').value,
        description: document.getElementById('serverDescription').value,
        maxUsers: parseInt(document.getElementById('maxUsers').value),
        isActive: document.getElementById('isActive').checked
    };

    try {
        const adminUser = localStorage.getItem(ADMIN_USER_KEY);
        if (!adminUser) {
            window.location.href = '/adminlogin.html';
            return;
        }

        const url = serverId ? 
            `${API_URL}/admin/servers/${serverId}` : 
            `${API_URL}/admin/servers`;

        const response = await fetch(url, {
            method: serverId ? 'PUT' : 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JSON.parse(adminUser).token}`
            },
            body: JSON.stringify(serverData)
        });

        const data = await response.json();
        if (data.success) {
            alert(serverId ? 'Server başarıyla güncellendi!' : 'Server başarıyla oluşturuldu!');
            const modal = bootstrap.Modal.getInstance(document.getElementById('serverModal'));
            modal.hide();
            loadServers();
        } else {
            throw new Error(data.error || 'İşlem sırasında bir hata oluştu!');
        }
    } catch (error) {
        console.error('Server kaydetme hatası:', error);
        alert('İşlem sırasında bir hata oluştu!');
    }
}

// Server sil
async function deleteServer(serverId) {
    try {
        const adminUser = localStorage.getItem(ADMIN_USER_KEY);
        if (!adminUser) {
            window.location.href = '/adminlogin.html';
            return;
        }

        const response = await fetch(`${API_URL}/admin/servers/${serverId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JSON.parse(adminUser).token}`
            }
        });

        const data = await response.json();
        if (data.success) {
            alert('Server başarıyla silindi!');
            loadServers();
        } else {
            throw new Error(data.error || 'Silme işlemi sırasında bir hata oluştu!');
        }
    } catch (error) {
        console.error('Server silme hatası:', error);
        alert('Silme işlemi sırasında bir hata oluştu!');
    }
} 