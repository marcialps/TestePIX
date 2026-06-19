# Firebase Cloud Functions - Setup Guide

## Visão Geral

Implementação de Firebase Cloud Functions para permitir alteração direta de senha de usuários por administradores, sem necessidade de email de reset.

## Estrutura

```
BetaBarbeariaPIX/
├── functions/
│   ├── index.js          # Cloud Functions implementation
│   └── package.json      # Dependencies
├── firebase.json         # Firebase configuration
└── .firebaserc          # Firebase project settings
```

## Configuração

### 1. Instalar Firebase CLI

Se ainda não tem o Firebase CLI instalado:

```bash
npm install -g firebase-tools
```

### 2. Login no Firebase

```bash
firebase login
```

### 3. Instalar dependências das Functions

Na raiz do projeto:

```bash
cd functions
npm install
cd ..
```

### 4. Deploy das Cloud Functions

```bash
firebase deploy --only functions
```

## Cloud Function Implementada

### `changePassword`

Função callable que permite administradores alterar a senha de qualquer usuário diretamente.

**Segurança:**
- Requer autenticação Firebase
- Verifica se o usuário tem role `admin` ou `superadmin` no Firestore
- Valida senha mínima de 6 caracteres
- Usa Firebase Admin SDK para alteração segura

## Como usar no Frontend

Adicione esta função ao seu código JavaScript:

```javascript
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-functions.js';

// Inicializar Functions
const functions = getFunctions();

// Função para alterar senha
async function changeUserPassword(email, newPassword) {
  try {
    const changePasswordFunction = httpsCallable(functions, 'changePassword');
    const result = await changePasswordFunction({ email, newPassword });
    return result.data;
  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    throw error;
  }
}

// Exemplo de uso
// await changeUserPassword('usuario@exemplo.com', 'novaSenha123');
```

## Testar Localmente

Para testar as functions localmente:

```bash
firebase emulators:start
```

As functions estarão disponíveis em `http://localhost:5001`.

## Logs

Para ver os logs das functions:

```bash
firebase functions:log
```

## Vantagens do Cloud Functions

- ✅ **Sem servidor** - Não precisa de hospedagem adicional
- ✅ **Escala automática** - Firebase gerencia a infraestrutura
- ✅ **Integração nativa** - Funciona perfeitamente com Firebase Auth e Firestore
- ✅ **Seguro** - Executa em ambiente seguro do Google
- ✅ **Gratuito (até limites)** - Plano gratuito generoso para pequenos projetos

## Custos

O plano gratuito do Firebase inclui:
- 125.000 invocações de functions/mês
- 40.000 GB-segundos de tempo de execução/mês
- 10 GB de tráfego de rede/mês

Para uso moderado, provavelmente ficará no plano gratuito.

## Suporte

Se precisar de ajuda, consulte:
- [Firebase Cloud Functions Documentation](https://firebase.google.com/docs/functions)
- [Firebase Pricing](https://firebase.google.com/pricing)
