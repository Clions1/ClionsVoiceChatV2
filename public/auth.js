// Mevcut oturum bilgisini saklamak için
const CURRENT_USER_KEY = 'clions_current_user';
const API_URL = 'http://localhost:3000/api';

// Kullanıcı girişi yap
async function login(username, password) {
    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        
        if (data.success) {
            localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(data.user));
            return true;
        }
        return false;
    } catch (error) {
        console.error('Giriş hatası:', error);
        throw error;
    }
}

// Yeni kullanıcı kaydı
async function registerUser(username, email, password) {
    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        return data.success;
    } catch (error) {
        console.error('Kayıt hatası:', error);
        throw error;
    }
}

// Mevcut kullanıcıyı kontrol et
function checkCurrentUser() {
    const currentUser = localStorage.getItem(CURRENT_USER_KEY);
    const currentPath = window.location.pathname;

    // Login veya register sayfasında değilse ve oturum yoksa
    if (!currentUser && !currentPath.includes('/login.html') && !currentPath.includes('/register.html')) {
        window.location.href = '/login.html';
        return null;
    }

    // Oturum varsa ve login veya register sayfasındaysa
    if (currentUser && (currentPath.includes('/login.html') || currentPath.includes('/register.html'))) {
        window.location.href = '/index.html';
        return null;
    }

    return currentUser ? JSON.parse(currentUser) : null;
}

// Çıkış yap
function logout() {
    localStorage.removeItem(CURRENT_USER_KEY);
    window.location.href = '/login.html';
}

// Kayıt formu işlemleri
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (password !== confirmPassword) {
            alert('Şifreler eşleşmiyor!');
            return;
        }

        try {
            await registerUser(username, email, password);
            alert('Kayıt başarılı! Giriş yapabilirsiniz.');
            window.location.href = '/login.html';
        } catch (error) {
            alert(error.message || 'Kayıt sırasında bir hata oluştu!');
        }
    });
}

// Giriş formu işlemleri
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const success = await login(username, password);
            if (success) {
                window.location.href = '/index.html';
            } else {
                alert('Kullanıcı adı veya şifre hatalı!');
            }
        } catch (error) {
            alert('Giriş sırasında bir hata oluştu!');
        }
    });
}

// Sayfa yüklendiğinde mevcut kullanıcıyı kontrol et
document.addEventListener('DOMContentLoaded', () => {
    checkCurrentUser();
}); 