-- Estrutura da BD do site PHP antigo (bd_teste.db). Só estrutura, sem dados.
-- Serve para gerar a BD falsa de teste da F2-08. A BD real nunca entra neste repositório.
-- Valores de produtos.tipo encontrados: Bebidas, bebidas, aguardentes, brandy, cafetaria, comidas,
-- espirituosas, gin, licores, martinis, portos, whiskys. Preço em euros (NUMERIC). Texto guardado com htmlspecialchars.
-- eventos.data_evento pode estar como texto vazio (''), apesar do NOT NULL.

CREATE TABLE admin_users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT NOT NULL,
	psw TEXT NOT NULL
);

CREATE TABLE eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_evento TEXT NOT NULL,
    data_evento DATE NOT NULL,
    descricao TEXT,
    imagem_url TEXT
, visivel INTEGER DEFAULT 1);

CREATE TABLE fotos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome_foto TEXT NOT NULL,
            caminho TEXT NOT NULL,
            descricao TEXT,
            data_upload DATETIME DEFAULT CURRENT_TIMESTAMP,
            visivel INTEGER DEFAULT 1
        , status TEXT DEFAULT 'pendente', uploaded_by TEXT, is_admin_upload INTEGER DEFAULT 0);

CREATE TABLE produtos (id_produto INTEGER PRIMARY KEY AUTOINCREMENT, nome_prod TEXT, preco NUMERIC, tipo VARCHAR (100));

CREATE TABLE "tomazia_clientes" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    nome TEXT,
    email TEXT,
    telemovel TEXT
, data_registro DATETIME);

CREATE UNIQUE INDEX idx_unique_email ON tomazia_clientes(email);

CREATE UNIQUE INDEX idx_unique_telemovel ON tomazia_clientes(telemovel);

CREATE UNIQUE INDEX idx_unique_username ON admin_users(username);
