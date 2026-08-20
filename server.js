import express from 'express';
import path from 'path';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORRIGIDO: Permite que o Express sirva os arquivos HTML sem que você precise digitar o ".html" na URL
app.use(express.static('public', { extensions: ['html'] }));

// Rota padrão para entregar a página inicial
app.get('/', (req, res) => {
    res.sendFile(path.resolve('public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sistema do Mural ativo localmente na porta ${PORT}`);
});
