import express from 'express';
import session from 'express-session';
import path from 'path';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'chave-secreta-mural-escolar-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Servir arquivos estáticos do front-end
app.use(express.static('public'));

// Rota coringa para garantir o carregamento do painel
app.get('*', (req, res) => {
    res.sendFile(path.resolve('public', 'index.html'));
});

// CORRIGIDO: Injeção de porta dinâmica obrigatória para o Render aceitar conexões externas
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor estático ativo na porta ${PORT}`);
});
