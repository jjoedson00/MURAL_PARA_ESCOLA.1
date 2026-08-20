import express from 'express';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
// O Render define a porta automaticamente através de process.env.PORT
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// CONFIGURAÇÃO DO BANCO DE DADOS (PostgreSQL do Render)
// -------------------------------------------------------------
// COLE AQUI a "External Database URL" que você copiou do painel do Render
const DB_URL = "SUA_EXTERNAL_DATABASE_URL_AQUI";

const pool = new pg.Pool({
    connectionString: DB_URL,
    ssl: {
        rejectUnauthorized: false // Obrigatório para conexões seguras no Render
    }
});

// Criar tabela de usuários caso ela não exista no PostgreSQL
const criarTabela = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                senha TEXT NOT NULL
            )
        `);
        console.log('Tabela de usuários verificada/criada no Render.');
    } catch (err) {
        console.error('Erro ao criar tabela:', err.message);
    }
};
criarTabela();

// -------------------------------------------------------------
// ROTAS DO SISTEMA
// -------------------------------------------------------------

// Rota de Cadastro
app.post('/auth/cadastro', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ erro: 'Preencha todos os campos.' });
    }

    try {
        const query = 'INSERT INTO usuarios (email, senha) VALUES ($1, $2)';
        await pool.query(query, [email, senha]);
        res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso!' });
    } catch (err) {
        if (err.message.includes('unique') || err.code === '23505') {
            return res.status(400).json({ erro: 'Este e-mail já está cadastrado.' });
        }
        res.status(500).json({ erro: 'Erro ao salvar no banco do servidor.' });
    }
});

// Rota de Login
app.post('/auth/login', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ erro: 'Preencha todos os campos.' });
    }

    try {
        const query = 'SELECT * FROM usuarios WHERE email = $1 AND senha = $2';
        const result = await pool.query(query, [email, senha]);

        if (result.rows.length > 0) {
            res.json({ autenticado: true, usuario: result.rows[0].email });
        } else {
            res.status(401).json({ autenticado: false, erro: 'Credenciais incorretas.' });
        }
    } catch (err) {
        res.status(500).json({ erro: 'Erro interno no servidor remoto.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor ativo na porta ${PORT}`);
});
