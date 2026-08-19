const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const FileStore = require('session-file-store')(session); 
const fs = require('fs'); // Módulo nativo para manipulação de pastas

const app = express();

// === CRIAÇÃO AUTOMÁTICA DE PASTAS OBRIGATÓRIAS PARA O RENDER ===
const pastasObrigatorias = [
    path.join(__dirname, 'sessions'),
    path.join(__dirname, 'public'),
    path.join(__dirname, 'public', 'uploads')
];
pastasObrigatorias.forEach(pasta => {
    if (!fs.existsSync(pasta)) {
        fs.mkdirSync(pasta, { recursive: true });
    }
});

const db = new sqlite3.Database('./database.db');

// Configurações Básicas do Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Gerenciamento de Sessão por Arquivos Locais
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

// Redirecionamento da Página Inicial para as Rotas Amigáveis
app.get('/', (req, res) => res.redirect('/mural'));


// Roteamento sem a extensão .html na barra de endereços
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/cadastro', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cadastro.html')));
app.get('/mural', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mural.html')));

// Configuração do Multer para Upload Seguro de Imagens de Referência
const storage = multer.diskStorage({
    destination: 'public/uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Inicialização Automatizada das Tabelas Relacionais do SQLite
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT UNIQUE, 
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

// Credencial mestra para validação de cargos da gestão escolar
const CHAVE_FUNCIONARIO = "COORDENACAO2026";

// ROTA DE CADASTRO: Valida tamanho da senha e impede e-mails ou nomes repetidos
app.post('/auth/cadastro', async (req, res) => {
    const { nome, email, senha, cargo, chaveAcesso } = req.body;
    
    // Validação estrita de barreira de caracteres
    if (!senha || senha.length < 6) {
        return res.status(400).json({ erro: 'A senha deve conter no mínimo 6 caracteres.' });
    }

    if (['professor', 'coordenador', 'direcao'].includes(cargo)) {
        if (!chaveAcesso || chaveAcesso !== CHAVE_FUNCIONARIO) {
            return res.status(403).json({ erro: 'Chave de acesso de funcionário inválida!' });
        }
    }

    const senhaCriptografada = await bcrypt.hash(senha, 10);
    
    db.run(`INSERT INTO usuarios (nome, email, senha, cargo) VALUES (?, ?, ?, ?)`, 
        [nome.trim(), email.trim(), senhaCriptografada, cargo], 
        (err) => {
            if (err) {
                // Captura e trata erros de violação de chaves únicas (UNIQUE) do SQLite
                if (err.message.includes('usuarios.email') || err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ erro: 'Este email já está cadastrado em outra conta.' });
                }
                if (err.message.includes('usuarios.nome')) {
                    return res.status(400).json({ erro: 'Este nome de usuário já está em uso.' });
                }
                return res.status(400).json({ erro: 'Erro ao realizar cadastro.' });
            }
            return res.json({ sucesso: true });
        }
    );
});

// ROTA DE LOGIN: Aceita autenticação por e-mail ou nome do usuário de forma híbrida
app.post('/auth/login', (req, res) => {
    const { identificador, senha } = req.body; 
    
    db.get(`SELECT * FROM usuarios WHERE email = ? OR nome = ?`, [identificador.trim(), identificador.trim()], async (err, usuario) => {
        if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
            return res.status(400).json({ erro: 'Usuário/Email ou senha incorretos.' });
        }
        req.session.userId = usuario.id;
        req.session.usuario = { nome: usuario.nome, cargo: usuario.cargo };
        
        req.session.save(() => {
            return res.json({ sucesso: true });
        });
    });
});

// ROTA DE RECUPERAÇÃO: Atualizada e direta, sem pergunta de segurança
app.post('/auth/recuperar-senha', async (req, res) => {
    const { identificador, novaSenha } = req.body;

    db.get(`SELECT * FROM usuarios WHERE email = ? OR nome = ?`, [identificador.trim(), identificador.trim()], async (err, usuario) => {
        if (!usuario) {
            return res.status(400).json({ erro: 'Usuário ou E-mail não encontrado.' });
        }

        if (!novaSenha || novaSenha.length < 6) {
            return res.status(400).json({ erro: 'A nova senha deve ter no mínimo 6 caracteres.' });
        }

        const novaSenhaCripto = await bcrypt.hash(novaSenha, 10);
        db.run(`UPDATE usuarios SET senha = ? WHERE id = ?`, [novaSenhaCripto, usuario.id], (err) => {
            if (err) return res.status(500).json({ erro: 'Erro ao atualizar a senha.' });
            return res.json({ sucesso: true });
        });
    });
});

// Rota de consumo interna para mapear sessões ativas do Front-end
app.get('/api/usuario-atual', (req, res) => {
    if (!req.session || !req.session.usuario) return res.status(401).json({ erro: 'Não logado' });
    res.json(req.session.usuario);
});

// Destruição instantânea de sessão e expiração dos vestígios de cookies
app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid'); 
        res.redirect('/login');   
    });
});

// Get de todos os avisos em ordem decrescente (Novos no topo)
app.get('/api/avisos', (req, res) => {
    db.all(`SELECT * FROM avisos ORDER BY id DESC`, [], (err, rows) => {
        res.json(rows);
    });
});

// Endpoint de gravação de comunicados com tratamento de uploads opcional
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

// Remoção direta de publicações acionada por gestores cadastrados
app.delete('/api/avisos/:id', (req, res) => {
    if (!req.session.usuario || ['aluno', 'responsavel'].includes(req.session.usuario.cargo)) {
        return res.status(403).json({ erro: 'Acesso negado.' });
    }
    db.run(`DELETE FROM avisos WHERE id = ?`, [req.params.id], () => {
        res.json({ sucesso: true });
    });
});

// Define a porta dinâmica aceita pelo Render
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando com sucesso na porta ${PORT}`);
});
