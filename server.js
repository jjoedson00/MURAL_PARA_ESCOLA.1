const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const db = new sqlite3.Database('./database.db');

// Configuração do Multer para Upload de Imagens
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads';
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: 'chave-secreta-do-mural',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // mude para true se usar HTTPS
}));

// Criar Tabelas no Banco de Dados se não existirem
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        email TEXT UNIQUE,
        senha TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS avisos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT,
        conteudo TEXT,
        imagem TEXT,
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// --- ROTAS DE AUTENTICAÇÃO ---

// Cadastro de Usuário
app.post('/api/cadastro', async (req, res) => {
    const { nome, email, senha } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(senha, 10);
        const query = `INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)`;
        db.run(query, [nome, email, hashedPassword], function(err) {
            if (err) return res.status(400).json({ erro: 'Email já cadastrado.' });
            res.json({ sucesso: true });
        });
    } catch {
        res.status(500).json({ erro: 'Erro no servidor.' });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { email, senha } = req.body;
    const query = `SELECT * FROM usuarios WHERE email = ?`;
    
    db.get(query, [email], async (err, usuario) => {
        if (err || !usuario) return res.status(400).json({ erro: 'Usuário não encontrado.' });
        
        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) return res.status(400).json({ erro: 'Senha incorreta.' });
        
        req.session.usuarioId = usuario.id;
        req.session.usuarioNome = usuario.nome;
        res.json({ sucesso: true });
    });
});

// Logout
app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ sucesso: true });
});

// Verificar se usuário está logado
app.get('/api/usuario-atual', (req, res) => {
    if (req.session.usuarioId) {
        res.json({ logado: true, nome: req.session.usuarioNome });
    } else {
        res.json({ logado: false });
    }
});

// --- ROTAS DOS AVISOS ---

// Listar todos os avisos
app.get('/api/avisos', (req, res) => {
    db.all(`SELECT * FROM avisos ORDER BY data_criacao DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

// Criar novo aviso (Requer estar logado)
app.post('/api/avisos', upload.single('imagem'), (req, res) => {
    if (!req.session.usuarioId) return res.status(401).json({ erro: 'Não autorizado.' });
    
    const { titulo, conteudo } = req.body;
    const imagemPath = req.file ? `/uploads/${req.file.filename}` : null;
    
    const query = `INSERT INTO avisos (titulo, conteudo, imagem) VALUES (?, ?, ?)`;
    db.run(query, [titulo, conteudo, imagemPath], function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true, id: this.lastID });
    });
});

// Apagar aviso (Requer estar logado)
app.delete('/api/avisos/:id', (req, res) => {
    if (!req.session.usuarioId) return res.status(401).json({ erro: 'Não autorizado.' });
    
    const id = req.params.id;
    
    // Primeiro buscar a imagem para deletar o arquivo do servidor
    db.get(`SELECT imagem FROM avisos WHERE id = ?`, [id], (err, row) => {
        if (row && row.imagem) {
            const fullPath = path.join(__dirname, 'public', row.imagem);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
        
        // Deletar do banco
        db.run(`DELETE FROM avisos WHERE id = ?`, [id], function(err) {
            if (err) return res.status(500).json({ erro: err.message });
            res.json({ sucesso: true });
        });
    });
});

// --- ALTERAÇÃO AQUI: Porta dinâmica para o Render ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
