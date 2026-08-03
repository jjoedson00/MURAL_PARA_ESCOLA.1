const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const FileStore = require('session-file-store')(session); 

const app = express();
const db = new sqlite3.Database('./database.db');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    store: new FileStore({ path: './sessions', ttl: 86400, logFn: function() {} }),
    secret: 'chave-secreta-do-mural',
    resave: false,               
    saveUninitialized: false,    
    cookie: { maxAge: 1000 * 60 * 60 * 24, secure: false }
}));

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/cadastro', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cadastro.html')));
app.get('/mural', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mural.html')));

const storage = multer.diskStorage({
    destination: 'public/uploads/',
    filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage });

db.serialize(() => {
    // ATUALIZADO: Incluindo campos de pergunta e resposta de segurança
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT UNIQUE, 
        email TEXT UNIQUE,
        senha TEXT,
        cargo TEXT,
        pergunta TEXT,
        resposta TEXT
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

const CHAVE_FUNCIONARIO = "COORDENACAO2026";

app.post('/auth/cadastro', async (req, res) => {
    const { nome, email, senha, cargo, chaveAcesso, pergunta, resposta } = req.body;
    
    if (!senha || senha.length < 6) {
        return res.status(400).json({ erro: 'A senha deve conter no mínimo 6 caracteres.' });
    }
    if (!pergunta || !resposta) {
        return res.status(400).json({ erro: 'Preencha a pergunta e resposta de segurança.' });
    }

    if (['professor', 'coordenador', 'direcao'].includes(cargo)) {
        if (chaveAcesso !== CHAVE_FUNCIONARIO) {
            return res.status(403).json({ erro: 'Chave de acesso de funcionário inválida!' });
        }
    }

    const senhaCriptografada = await bcrypt.hash(senha, 10);
    
    db.run(`INSERT INTO usuarios (nome, email, senha, cargo, pergunta, resposta) VALUES (?, ?, ?, ?, ?, ?)`, 
        [nome.trim(), email.trim(), senhaCriptografada, cargo, pergunta, resposta.trim().toLowerCase()], 
        (err) => {
            if (err) {
                if (err.message.includes('usuarios.nome')) {
                    return res.status(400).json({ erro: 'Este nome de usuário já está em uso.' });
                }
                return res.status(400).json({ erro: 'Este email já está cadastrado.' });
            }
            return res.json({ sucesso: true });
        }
    );
});

app.post('/auth/login', (req, res) => {
    const { identificador, senha } = req.body;
    db.get(`SELECT * FROM usuarios WHERE email = ? OR nome = ?`, [identificador.trim(), identificador.trim()], async (err, usuario) => {
        if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
            return res.status(400).json({ erro: 'Usuário/Email ou senha incorretos.' });
        }
        req.session.userId = usuario.id;
        req.session.usuario = { nome: usuario.nome, cargo: usuario.cargo };
        req.session.save(() => { return res.json({ sucesso: true }); });
    });
});

// NOVA ROTA: Recuperação e redefinição de senha instantânea
app.post('/auth/recuperar-senha', async (req, res) => {
    const { identificador, pergunta, resposta, novaSenha, passo } = req.body;

    db.get(`SELECT * FROM usuarios WHERE email = ? OR nome = ?`, [identificador.trim(), identificador.trim()], async (err, usuario) => {
        if (!usuario) {
            return res.status(400).json({ erro: 'Usuário ou E-mail não encontrado.' });
        }

        // Passo 1: Apenas busca e devolve a pergunta cadastrada daquele usuário
        if (passo === 1) {
            return res.json({ pergunta: usuario.pergunta });
        }

        // Passo 2: Valida a resposta e grava a nova senha criptografada
        if (passo === 2) {
            if (usuario.resposta !== resposta.trim().toLowerCase()) {
                return res.status(400).json({ erro: 'Resposta de segurança incorreta!' });
            }
            if (!novaSenha || novaSenha.length < 6) {
                return res.status(400).json({ erro: 'A nova senha deve ter no mínimo 6 caracteres.' });
            }

            const novaSenhaCripto = await bcrypt.hash(novaSenha, 10);
            db.run(`UPDATE usuarios SET senha = ? WHERE id = ?`, [novaSenhaCripto, usuario.id], (err) => {
                if (err) return res.status(500).json({ erro: 'Erro ao atualizar a senha.' });
                return res.json({ sucesso: true });
            });
        }
    });
});

app.get('/api/usuario-atual', (req, res) => {
    if (!req.session || !req.session.usuario) return res.status(401).json({ erro: 'Não logado' });
    res.json(req.session.usuario);
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/login'); });
});

app.get('/api/avisos', (req, res) => {
    db.all(`SELECT * FROM avisos ORDER BY id DESC`, [], (err, rows) => { res.json(rows); });
});

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
        () => res.redirect('/mural')
    );
});

app.delete('/api/avisos/:id', (req, res) => {
    if (!req.session.usuario || ['aluno', 'responsavel'].includes(req.session.usuario.cargo)) {
        return res.status(403).json({ erro: 'Acesso negado.' });
    }
    db.run(`DELETE FROM avisos WHERE id = ?`, [req.params.id], () => { res.json({ sucesso: true }); });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
