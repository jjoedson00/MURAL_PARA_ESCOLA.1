const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const FileStore = require('session-file-store')(session); 

const app = express();
const db = new sqlite3.Database('./database.db');

// Configurações Básicas
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Armazena o login em arquivos locais evitando conflitos
app.use(session({
    store: new FileStore({
        path: './sessions',
        ttl: 86400, 
        logFn: function() {} 
    }),
    secret: 'chave-secreta-do-mural',
    resave: false,               
    saveUninitialized: false,    
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24, 
        secure: false           
    }
}));

// Redireciona a página inicial diretamente para a tela de login
app.get('/', (req, res) => res.redirect('/index.html'));

// Configuração do upload de imagens
const storage = multer.diskStorage({
    destination: 'public/uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Criar Tabelas no Banco de Dados
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        email TEXT UNIQUE,
        senha TEXT,
        cargo TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS avisos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT,
        conteudo TEXT,
        imagem TEXT,
        autor TEXT,
        data TEXT
    )`);
});

// Chave secreta dos funcionários
const CHAVE_FUNCIONARIO = "COORDENACAO2026";

// Rota de Cadastro
app.post('/auth/cadastro', async (req, res) => {
    const { nome, email, senha, cargo, chaveAcesso } = req.body;
    
    if (['professor', 'coordenador', 'direcao'].includes(cargo)) {
        if (chaveAcesso !== CHAVE_FUNCIONARIO) {
            return res.status(403).send('Chave de acesso de funcionário inválida!');
        }
    }

    const senhaCriptografada = await bcrypt.hash(senha, 10);
    
    db.run(`INSERT INTO usuarios (nome, email, senha, cargo) VALUES (?, ?, ?, ?)`, 
        [nome, email, senhaCriptografada, cargo], 
        (err) => {
            if (err) return res.status(400).send('Email já cadastrado.');
            res.redirect('/index.html');
        }
    );
});

// Rota de Login
app.post('/auth/login', (req, res) => {
    const { email, senha } = req.body;
    db.get(`SELECT * FROM usuarios WHERE email = ?`, [email], async (err, usuario) => {
        if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
            return res.status(400).send('Email ou senha incorretos.');
        }
        req.session.userId = usuario.id;
        req.session.usuario = { nome: usuario.nome, cargo: usuario.cargo };
        
        req.session.save(() => {
            res.redirect('/mural.html');
        });
    });
});

// Rota para pegar dados do usuário logado
app.get('/api/usuario-atual', (req, res) => {
    if (!req.session || !req.session.usuario) return res.status(401).json({ erro: 'Não logado' });
    res.json(req.session.usuario);
});

// ALTERADO: Rota de Logout rápida, remove cookies e sai no mesmo instante
app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid'); 
        res.redirect('/index.html');    
    });
});

// Listar Avisos
app.get('/api/avisos', (req, res) => {
    db.all(`SELECT * FROM avisos ORDER BY id DESC`, [], (err, rows) => {
        res.json(rows);
    });
});

// Criar Aviso
app.post('/api/avisos', upload.single('imagem'), (req, res) => {
    if (!req.session.usuario || ['aluno', 'responsavel'].includes(req.session.usuario.cargo)) {
        return res.status(403).send('Acesso negado.');
    }
    const { titulo, conteudo } = req.body;
    const imagem = req.file ? `/uploads/${req.file.filename}` : '';
    const autor = req.session.usuario.nome;
    const data = new Date().toLocaleDateString('pt-BR');

    db.run(`INSERT INTO avisos (titulo, conteudo, imagem, autor, data) VALUES (?, ?, ?, ?, ?)`,
        [titulo, conteudo, imagem, autor, data],
        () => res.redirect('/mural.html')
    );
});

// Deletar Aviso
app.delete('/api/avisos/:id', (req, res) => {
    if (!req.session.usuario || ['aluno', 'responsavel'].includes(req.session.usuario.cargo)) {
        return res.status(403).json({ erro: 'Acesso negado.' });
    }
    db.run(`DELETE FROM avisos WHERE id = ?`, [req.params.id], () => {
        res.json({ sucesso: true });
    });
});

// O servidor usa a porta automática do Render ou a 3000 localmente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

