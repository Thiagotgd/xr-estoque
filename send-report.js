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

const linhas = itens.map(i => {
  const pedir = i.qtd_compra > 0 ? i.qtd_compra : i.falta;
  return `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${i.nome}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;font-weight:600">${i.estoque_atual}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${i.estoque_minimo}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#d97706;font-weight:600">${i.falta}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#059669;font-weight:600">${pedir}</td>
  </tr>`;
}).join('');

const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <div style="background:#1a2a4a;padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:20px">📦 Lista de Compras — XR Estoque</h1>
      <p style="color:#93c5fd;margin:4px 0 0;font-size:14px">${hoje}</p>
    </div>
    <div style="padding:24px 32px">
      <p style="color:#374151;margin:0 0 16px">${itens.length} item(s) abaixo do estoque mínimo:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600">Produto</th>
            <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:600">Atual</th>
            <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:600">Mínimo</th>
            <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:600">Falta</th>
            <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:600">Pedir</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    <div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb">
      <p style="color:#9ca3af;font-size:12px;margin:0">XR Diagnóstico Veterinário · Relatório automático toda segunda-feira</p>
    </div>
  </div>
</body>
</html>`;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: 'cerebrogrego@gmail.com', pass: 'erpijwabkhijpjnn' }
});

transporter.sendMail({
  from: '"XR Estoque" <cerebrogrego@gmail.com>',
  to: 'xrdiagnostico@gmail.com',
  subject: `📦 Lista de Compras — ${itens.length} item(s) para repor`,
  html
}, (err, info) => {
  if (err) { console.error('Erro ao enviar:', err.message); process.exit(1); }
  console.log('E-mail enviado:', info.messageId);
});
