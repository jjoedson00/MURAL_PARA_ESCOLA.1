const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');

const app = express();
const port = 3000;

app.use(express.json());

// CONFIGURAÇÃO DO MULTER
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/'); 
    },
    filename: function (req, file, cb) {
        const extensao = path.extname(file.originalname);
        const nomeUnico = Date.now() + '-' + Math.round(Math.random() * 1E9) + extensao;
        cb(null, nomeUnico);
    }
});
const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

const pool = new Pool({
    user: 'postgres',          
    host: 'localhost',         
    database: 'Mural_meu-tcc1',     
    password: '1234',               
    port: 5432,                
});

// --- ROTAS DE NAVEGAÇÃO ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'mural.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'public', 'mural.html'));
    });
});

app.get('/mural.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'mural.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'public', 'mural.html'));
    });
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    });
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'public', 'login.html'));
    });
});

app.get('/cadastro.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'cadastro.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'public', 'cadastro.html'));
    });
});

// --- CADASTRO E LOGIN ---
app.post('/api/cadastro', async (req, res) => {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: "Todos os campos são obrigatórios!" });
    try {
        await pool.query('INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4)', [nome, email, senha, 'professor']);
        res.status(201).json({ sucesso: true, message: "Professor cadastrado!" });
    } catch (erro) {
        if (erro.code === '23505') return res.status(400).json({ erro: "Este e-mail já está cadastrado!" });
        res.status(500).json({ erro: erro.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const consulta = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1) AND senha = $2 AND tipo = $3', [email, senha, 'professor']);
        if (consulta.rows.length > 0) res.json({ sucesso: true, mensagem: "Login efetuado!" });
        else res.status(401).json({ erro: "E-mail ou senha incorretos." });
    } catch (erro) {
        res.status(500).json({ erro: "Erro no login." });
    }
});

// --- API DE AVISOS (ATUALIZADA) ---
app.get('/api/avisos', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM avisos ORDER BY id DESC');
        const dadosLimpos = resultado.rows.map(row => ({
            id: row.id,
            titulo: row.titulo,
            conteudo: row.conteudo,
            prioridade: row.cor_destaque || row.prioridade || 'Normal',
            imagem: row.imagem || row.imagem_url || null,
            autor: row.autor || 'Professor', // Retorna o autor mapeado para o mural
            data_criacao: row.data_criacao || row.data || new Date()
        }));
        res.json(dadosLimpos);
    } catch (erro) {
        res.status(500).json({ error: "Erro ao listar comunicados." });
    }
});

app.post('/api/avisos', upload.single('imagem'), async (req, res) => {
    try {
        const { titulo, conteudo, prioridade, autor } = req.body;
        const nomeImagem = req.file ? req.file.filename : null;

        if (!titulo || !conteudo) {
            return res.status(400).json({ error: "Título e Conteúdo são obrigatórios!" });
        }

        // Adicionado o campo $5 (autor) na Query estrutural
        const queryTexto = 'INSERT INTO avisos (titulo, conteudo, cor_destaque, imagem, autor, data_criacao) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) RETURNING *';
        await pool.query(queryTexto, [titulo, conteudo, prioridade || 'Normal', nomeImagem, autor || 'Professor']);
        
        return res.status(201).json({ mensagem: "Aviso publicado!" });
    } catch (erro) {
        console.error(erro);
        return res.status(500).json({ error: "Erro ao salvar aviso: " + erro.message });
    }
});

app.delete('/api/avisos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM avisos WHERE id = $1', [parseInt(req.params.id, 10)]);
        res.json({ mensagem: "Deletado com sucesso!" });
    } catch (erro) {
        res.status(500).json({ error: "Erro ao deletar." });
    }
});

app.listen(port, () => {
    console.log(`\n🚀 Servidor Rodando em: http://localhost:${port}`);
});
