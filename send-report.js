#!/usr/bin/env node
// Relatório semanal de estoque — envia toda segunda 08:00
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'estoque.db'), { readonly: true });

const itens = db.prepare(`
  SELECT nome, estoque_atual, estoque_minimo, qtd_compra,
    (estoque_minimo - estoque_atual) as falta
  FROM produtos
  WHERE estoque_minimo > 0 AND estoque_atual < estoque_minimo
  ORDER BY falta DESC
`).all();

if (itens.length === 0) {
  console.log('Nenhum item abaixo do mínimo — e-mail não enviado.');
  process.exit(0);
}

const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const linhasTexto = itens.map(i => {
  const pedir = i.qtd_compra > 0 ? i.qtd_compra : i.falta;
  return `• ${i.nome}\n  Atual: ${i.estoque_atual} | Mínimo: ${i.estoque_minimo} | Falta: ${i.falta} | Pedir: ${pedir}`;
}).join('\n\n');

const texto = `📦 LISTA DE COMPRAS — XR DIAGNÓSTICO
${hoje}
${'─'.repeat(40)}

${itens.length} item(s) abaixo do estoque mínimo:

${linhasTexto}

${'─'.repeat(40)}
Relatório automático toda segunda-feira às 08:00`;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: 'cerebrogrego@gmail.com', pass: 'erpijwabkhijpjnn' }
});

transporter.sendMail({
  from: '"XR Estoque" <cerebrogrego@gmail.com>',
  to: 'xrdiagnostico@gmail.com',
  subject: `📦 Lista de Compras — ${itens.length} item(s) para repor`,
  text: texto
}, (err, info) => {
  if (err) { console.error('Erro ao enviar:', err.message); process.exit(1); }
  console.log('E-mail enviado:', info.messageId);
});
