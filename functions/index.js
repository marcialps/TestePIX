const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// Cloud Function to change user password directly (admin only)
exports.changePassword = functions.https.onCall(async (data, context) => {
  // Check if user is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Usuário não autenticado'
    );
  }

  // Get user data from Firestore to check role
  const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  
  if (!userDoc.exists) {
    throw new functions.https.HttpsError(
      'not-found',
      'Usuário não encontrado no Firestore'
    );
  }

  const userData = userDoc.data();

  // Check if user is admin or superadmin
  if (userData.role !== 'admin' && userData.role !== 'superadmin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Apenas administradores podem alterar senhas'
    );
  }

  const { email, newPassword } = data;

  // Validate input
  if (!email || !newPassword) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Email e nova senha são obrigatórios'
    );
  }

  if (newPassword.length < 6) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'A senha deve ter pelo menos 6 caracteres'
    );
  }

  try {
    // Get user by email
    const userRecord = await admin.auth().getUserByEmail(email);

    // Update password using admin SDK
    await admin.auth().updateUser(userRecord.uid, {
      password: newPassword
    });

    return {
      success: true,
      message: 'Senha alterada com sucesso'
    };
  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    
    if (error.code === 'auth/user-not-found') {
      throw new functions.https.HttpsError(
        'not-found',
        'Usuário não encontrado'
      );
    }
    
    throw new functions.https.HttpsError(
      'internal',
      'Erro ao alterar senha: ' + error.message
    );
  }
});
