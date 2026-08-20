import express from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url'; 

const app = express();
const PORT = process.env.PORT || 3000; 

// Configuração de caminhos para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); 

// Middlewares para leitura de dados
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public'))); 

// -------------------------------------------------------------
// CONFIGURAÇÃO DO BANCO DE DADOS
// -------------------------------------------------------------
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
if (err) {
return console.error('Erro ao abrir o banco de dados:', err.message);
}
console.log('Conectado ao banco de dados SQLite local.');
}); 

// Criar tabela de usuários
db.serialize(() => {
db.run(CREATE TABLE IF NOT EXISTS usuarios ( id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL ));
}); 

// -------------------------------------------------------------
// ROTAS DO SISTEMA
// ------------------------------------------------------------- 

// Rota de Cadastro
app.post('/auth/cadastro', (req, res) => {
const { email, senha } = req.body; 

if (!email || !senha) {
return res.status(400).json({ erro: 'Preencha todos os campos.' });
}

const query = INSERT INTO usuarios (email, senha) VALUES (?, ?);

db.run(query, [email, senha], function(err) {
if (err) {
if (err.message.includes('UNIQUE')) {
return res.status(400).json({ erro: 'Este e-mail já está cadastrado.' });
}
return res.status(500).json({ erro: 'Erro ao salvar no banco.' });
}
res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso!' });
});

}); 

// Rota de Login
app.post('/auth/login', (req, res) => {
const { email, senha } = req.body; 

if (!email || !senha) {
return res.status(400).json({ erro: 'Preencha todos os campos.' });
}

const query = SELECT * FROM usuarios WHERE email = ? AND senha = ?;

db.get(query, [email, senha], (err, row) => {
if (err) {
return res.status(500).json({ erro: 'Erro interno no servidor.' });
}
if (row) {
    res.json({ autenticado: true, usuario: row.email });
} else {
    res.status(401).json({ autenticado: false, erro: 'Credenciais incorretas.' });
}

});

}); 

// Inicialização do Servidor
app.listen(PORT, () => {
console.log(Servidor rodando localmente em: http://localhost:${PORT});
});