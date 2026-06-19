const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin SDK
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'barbersaas-5fb6d'
});

const auth = admin.auth();

// Middleware to verify admin token
async function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(token);
    
    // Check if user is admin or superadmin
    if (decodedToken.role !== 'admin' && decodedToken.role !== 'superadmin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem alterar senhas.' });
    }

    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Erro ao verificar token:', error);
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// Endpoint to change user password directly
app.post('/api/admin/change-password', verifyAdminToken, async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email e nova senha são obrigatórios' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    // Get user by email
    const userRecord = await auth.getUserByEmail(email);

    // Update password using admin SDK
    await auth.updateUser(userRecord.uid, {
      password: newPassword
    });

    res.json({ 
      success: true, 
      message: 'Senha alterada com sucesso' 
    });
  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    res.status(500).json({ error: 'Erro ao alterar senha: ' + error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend está funcionando' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
