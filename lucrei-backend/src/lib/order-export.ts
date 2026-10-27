import ExcelJS from 'exceljs';

export const STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Aguardando pagamento',
  READY_TO_SHIP: 'Pronto pra envio',
  PROCESSED: 'Em processamento',
  SHIPPED: 'Enviado',
  COMPLETED: 'Concluído',
  IN_CANCEL: 'Cancelando',
  CANCELLED: 'Cancelado',
  TO_RETURN: 'Em devolução',
};

// Excel/Sheets em PT-BR esperam vírgula decimal - ponto quebraria a leitura
// como número numa planilha com locale PT-BR.
export function csvNumber(n: number) {
  return n.toFixed(2).replace('.', ',');
}

// Só precisa escapar se o campo tiver o delimitador, aspas ou quebra de
// linha - produto poderia ter ";" ou quebra de linha no nome.
export function csvField(value: string) {
  if (/[;"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Mesmas colunas da planilha pros dois formatos - CSV formata número/data
// como texto (vírgula decimal, dd/mm/aaaa) pra abrir certo num locale PT-BR,
// enquanto o .xlsx guarda os valores nativos (Date/number) pra abrir já
// filtrável/somável no Excel sem precisar converter nada.
export async function buildOrdersXlsx(header: string[], rows: (string | number | Date | null)[][], sheetName: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(header);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);

  const dateColIndex = header.indexOf('Data do pedido') + 1;
  if (dateColIndex > 0) sheet.getColumn(dateColIndex).numFmt = 'dd/mm/yyyy';
  header.forEach((label, index) => {
    if (label.includes('(R$)')) sheet.getColumn(index + 1).numFmt = '#,##0.00';
  });
  sheet.columns.forEach((col) => {
    col.width = 18;
  });

  return workbook.xlsx.writeBuffer();
}
