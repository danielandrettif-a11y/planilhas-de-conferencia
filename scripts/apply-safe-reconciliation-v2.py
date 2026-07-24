from pathlib import Path

SOURCE_PATH = Path("src/lib/transformSpreadsheet.ts")
TEST_PATH = Path("src/lib/transformSpreadsheet.test.ts")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Marcador inesperado em {label}: encontrado {count} vez(es)")
    return text.replace(old, new, 1)


source = SOURCE_PATH.read_text(encoding="utf-8")

source = replace_once(
    source,
    '''  faltaPagar: number;
  informacoes: string;''',
    '''  faltaPagar: number;
  totalRetencoes?: number;
  origemLinha?: number;
  ignorarConsultaPagamento?: boolean;
  informacoes: string;''',
    "interface NotaFiscal",
)

old_to_number = '''function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null || String(value).trim() === "") return null;

  const cleaned = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d.,+-]/g, "");
  if (!cleaned || !/^[+-]?[\d.,]+$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = cleaned.split(thousandsSeparator).join("");
    normalized = normalized.replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    const isThousandsOnly = /^[+-]?\d{1,3}(?:\.\d{3})+$/.test(cleaned);
    normalized = isThousandsOnly ? cleaned.replace(/\./g, "") : cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}'''

new_to_number = '''function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null || String(value).trim() === "") return null;

  const original = String(value).trim();
  const indicator = original.match(/([DC])\s*$/i)?.[1]?.toUpperCase() ?? null;
  const cleaned = original
    .replace(/([DC])\s*$/i, "")
    .replace(/\s/g, "")
    .replace(/[^\d.,+-]/g, "");
  if (!cleaned || !/^[+-]?[\d.,]+$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = cleaned.split(thousandsSeparator).join("");
    normalized = normalized.replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    const isThousandsOnly = /^[+-]?\d{1,3}(?:\.\d{3})+$/.test(cleaned);
    normalized = isThousandsOnly ? cleaned.replace(/\./g, "") : cleaned;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (indicator === "D") return -Math.abs(parsed);
  if (indicator === "C") return Math.abs(parsed);
  return parsed;
}'''
source = replace_once(source, old_to_number, new_to_number, "leitura D/C")

source = replace_once(
    source,
    '''    if (ranked.length > 0 && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {''',
    '''    if (nota.ignorarConsultaPagamento) continue;
    if (ranked.length > 0 && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {''',
    "informações do mês anterior",
)

old_difference = '''function setPaymentDifferenceInfo(nota: NotaFiscal, paid: number): boolean {
  const difference = roundCurrency(paid - nota.valorNF);
  if (Math.abs(difference) < 0.01) return false;
  if (difference < 0) {
    nota.informacoes = `Pagou ${formatBRL(Math.abs(difference))} a menos`;
    addReason(nota, `O valor da NF é ${formatBRL(nota.valorNF)}, mas o pagamento localizado no ERP foi de ${formatBRL(paid)}. Foram pagos ${formatBRL(Math.abs(difference))} a menos.`);
  } else {
    nota.faltaPagar = -difference;
    nota.informacoes = `Pagou ${formatBRL(difference)} a mais`;
    addReason(nota, `O valor da NF é ${formatBRL(nota.valorNF)}, mas o pagamento localizado no ERP foi de ${formatBRL(paid)}. Foram pagos ${formatBRL(difference)} a mais.`);
  }
  return true;
}'''

new_difference = '''const RETENTION_DESCRIPTION_RE = /\\b(?:INSS|IRRF|ISS(?:QN)?|PIS|COFINS|CSLL|RETENCAO|IMPOSTO|ABATIMENTO|DESCONTO)\\b/i;

function isRetentionDescription(description: string): boolean {
  return RETENTION_DESCRIPTION_RE.test(removeAccents(description));
}

function isPaymentAmountClearlyIncompatible(nota: NotaFiscal, rows: NormalizedPayment[]): boolean {
  const titleTotal = paymentTotal(rows, "valorTitulo");
  const references = [nota.valorNF, Math.max(0, nota.faltaPagar)].filter((value) => value > MONEY_TOLERANCE);
  if (references.length === 0) return false;
  const distance = Math.min(...references.map((reference) => Math.abs(titleTotal - reference)));
  const largestReference = Math.max(...references);
  const tolerance = Math.max(5000, largestReference * 0.5);
  return distance > tolerance;
}

function setPaymentDifferenceInfo(nota: NotaFiscal, paid: number): boolean {
  const expectedPayment = roundCurrency(Math.max(0, nota.valorNF - (nota.totalRetencoes ?? 0)));
  const difference = roundCurrency(paid - expectedPayment);
  if (Math.abs(difference) < 0.01) return false;
  if (difference < 0) {
    nota.informacoes = `Pagou ${formatBRL(Math.abs(difference))} a menos`;
    addReason(nota, `O valor líquido esperado da NF é ${formatBRL(expectedPayment)}, mas o pagamento localizado no ERP foi de ${formatBRL(paid)}. Foram pagos ${formatBRL(Math.abs(difference))} a menos.`);
  } else {
    nota.faltaPagar = -difference;
    nota.informacoes = `Pagou ${formatBRL(difference)} a mais`;
    addReason(nota, `O valor líquido esperado da NF é ${formatBRL(expectedPayment)}, mas o pagamento localizado no ERP foi de ${formatBRL(paid)}. Foram pagos ${formatBRL(difference)} a mais.`);
  }
  return true;
}'''
source = replace_once(source, old_difference, new_difference, "comparação de pagamento líquido")

source = replace_once(
    source,
    '''  for (const nota of notas) {
    const previousInfo = nota.informacoes;''',
    '''  for (const nota of notas) {
    if (nota.ignorarConsultaPagamento) continue;
    const previousInfo = nota.informacoes;''',
    "ignorar lançamentos manuais no PDF",
)

source = replace_once(
    source,
    '''    const rows = uniquePayments(selection.rows);
    nota.confiancaAssociacao = selectionConfidence(selection);''',
    '''    const rows = uniquePayments(selection.rows);
    if (selection.supplierKind === "tokens") {
      nota.confiancaAssociacao = "Manual";
      nota.informacoes = "Possível pagamento localizado, mas o fornecedor não corresponde com segurança";
      addReason(nota, "A associação dependia apenas de palavras genéricas ou isoladas do fornecedor. Nenhum valor financeiro foi alterado.");
      markConferir(nota);
      continue;
    }
    if (isPaymentAmountClearlyIncompatible(nota, rows)) {
      nota.confiancaAssociacao = "Manual";
      nota.informacoes = "Possível pagamento localizado, mas o valor é incompatível";
      addReason(nota, `O grupo candidato no ERP soma ${formatBRL(paymentTotal(rows, "valorTitulo"))}, valor incompatível com a NF de ${formatBRL(nota.valorNF)}. Nenhum valor financeiro foi alterado.`);
      markConferir(nota);
      continue;
    }
    nota.confiancaAssociacao = selectionConfidence(selection);''',
    "bloqueio de associação financeira insegura",
)

source = replace_once(
    source,
    '''  const notas: NotaFiscal[] = [];
  const byNumero = new Map<string, NotaFiscal[]>();''',
    '''  const notas: NotaFiscal[] = [];
  const byNumero = new Map<string, NotaFiscal[]>();
  const sourceRows = new Set<number>();''',
    "rastreamento de linhas de NF",
)

source = replace_once(
    source,
    '''      faltaPagar: Math.abs(rawValue),
      informacoes: "",''',
    '''      faltaPagar: Math.abs(rawValue),
      totalRetencoes: 0,
      origemLinha: index + 2,
      informacoes: "",''',
    "campos de reconciliação da NF",
)

source = replace_once(
    source,
    '''    notas.push(nota);
    if (parsed.numero) byNumero.set(parsed.numero, [...(byNumero.get(parsed.numero) ?? []), nota]);''',
    '''    notas.push(nota);
    sourceRows.add(index);
    if (parsed.numero) byNumero.set(parsed.numero, [...(byNumero.get(parsed.numero) ?? []), nota]);''',
    "linha de origem da NF",
)

source = replace_once(
    source,
    '''    if (!target) return;
    target.faltaPagar += value;
    appliedRows.add(index);''',
    '''    if (!target) return;
    target.faltaPagar = roundCurrency(target.faltaPagar + value);
    if (isRetentionDescription(desc)) {
      target.totalRetencoes = roundCurrency((target.totalRetencoes ?? 0) + Math.abs(value));
    }
    appliedRows.add(index);''',
    "aplicação de retenções",
)

source = replace_once(
    source,
    '''  });

  return { notas };
}''',
    '''  });

  rows.forEach((row, index) => {
    if (sourceRows.has(index) || appliedRows.has(index)) return;
    const desc = String(row[histKey] ?? "").trim();
    const value = toNumber(row[valorKey]);
    if (!desc || value === null || Math.abs(value) < MONEY_TOLERANCE) return;

    const parsed = parseDescricao(desc);
    const reason = value > 0
      ? "Lançamento credor não identificado pelo padrão VALOR NF; valor preservado para fechar o saldo da conta."
      : parsed.numero
        ? `Lançamento devedor da NF ${parsed.numero} não associado com segurança; valor preservado separadamente.`
        : "Lançamento devedor sem NF identificável; valor preservado separadamente.";

    notas.push({
      data: (row[dataKey] as Date | string | number | null) ?? null,
      fornecedor: cleanFornecedor(desc.replace(/^VALOR\\s+/i, "")),
      notaFiscal: parsed.numero ?? "",
      valorNF: value > 0 ? value : 0,
      faltaPagar: roundCurrency(value),
      totalRetencoes: 0,
      origemLinha: index + 2,
      ignorarConsultaPagamento: true,
      informacoes: `${reason} (conferir)`,
      confiancaAssociacao: "Manual",
      motivosConferencia: [`${reason} Linha original ${index + 2}.`],
    });
  });

  return { notas };
}''',
    "preservação de lançamentos não associados",
)

source = replace_once(
    source,
    '''    for (const nota of sheet.result.notas) {
      const numero = normNota(nota.notaFiscal);''',
    '''    for (const nota of sheet.result.notas) {
      if (nota.ignorarConsultaPagamento) continue;
      const numero = normNota(nota.notaFiscal);''',
    "duplicidades de lançamentos manuais",
)

SOURCE_PATH.write_text(source, encoding="utf-8")

tests = TEST_PATH.read_text(encoding="utf-8")

old_weak_test = '''  it("aceita uma palavra relevante em comum no nome do fornecedor", () => {
    const current = nota({ fornecedor: "MARTEC EQUIPAMENTOS", notaFiscal: "6179", valorNF: 100, faltaPagar: 0 });
    const rows = [pagamento("6179", date(10, 5), 100, date(10, 5), "MARTEC SOLUCOES HOSPITALARES")];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).not.toContain("Não consta no ERP");
    expect(current.motivosConferencia.join(" ")).toContain("palavras relevantes em comum");
    expect(current.confiancaAssociacao).toBe("Média");
  });'''

new_weak_test = '''  it("não altera valores quando há somente uma palavra relevante em comum", () => {
    const current = nota({ fornecedor: "MARTEC EQUIPAMENTOS", notaFiscal: "6179", valorNF: 100, faltaPagar: 100 });
    const rows = [pagamento("6179", date(10, 5), 100, date(10, 5), "MARTEC SOLUCOES HOSPITALARES")];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.faltaPagar).toBe(100);
    expect(current.informacoes).toContain("fornecedor não corresponde com segurança");
    expect(current.confiancaAssociacao).toBe("Manual");
  });'''
tests = replace_once(tests, old_weak_test, new_weak_test, "teste de fornecedor fraco")

old_ambiguous_expectation = '''    expect(result.notas.map((item) => item.faltaPagar)).toEqual([21597.46, 5000]);
    expect(result.notas.every((item) => item.informacoes.includes("(conferir)"))).toBe(true);'''
new_ambiguous_expectation = '''    expect(result.notas.slice(0, 2).map((item) => item.faltaPagar)).toEqual([21597.46, 5000]);
    expect(result.notas[2].faltaPagar).toBe(-1004.27);
    expect(result.notas.slice(0, 2).every((item) => item.informacoes.includes("(conferir)"))).toBe(true);
    expect(result.notas[2].ignorarConsultaPagamento).toBe(true);'''
tests = replace_once(tests, old_ambiguous_expectation, new_ambiguous_expectation, "teste de retenção ambígua")

validation_marker = '''  it("não associa uma NF abreviada quando o mesmo final é ambíguo", () => {'''
new_validation_tests = '''  it("interpreta sufixos contábeis C e D armazenados como texto", () => {
    const result = transformRows([
      {
        "Descrição histórico": "VALOR NF - 9705-BIOVEP CONTROLE DE VETORES E PRAGAS LTDA",
        Valor: "680,37C",
        Data: date(30, 4),
      },
      {
        "Descrição histórico": "VALOR INSS DE TERCEIROS S/ NF - 9705-BIOVEP CONTROLE DE VETORES E PRAGAS LTDA",
        Valor: "74,84D",
        Data: date(30, 4),
      },
    ]);

    expect(result.notas[0].valorNF).toBe(680.37);
    expect(result.notas[0].faltaPagar).toBe(605.53);
    expect(result.notas[0].totalRetencoes).toBe(74.84);
  });

  it("preserva lançamentos sem NF associável para o saldo final fechar", () => {
    const result = transformRows([
      {
        "Descrição histórico": "VALOR NF - 100-FORNECEDOR TESTE LTDA",
        Valor: 1000,
        Data: date(1, 5),
      },
      {
        "Descrição histórico": "VALOR GIGA MAIS FIBRA TELECOMUNICACOES S.A.",
        Valor: 89.81,
        Data: date(2, 5),
      },
      {
        "Descrição histórico": "VALOR RETENCAO DE PIS COFINS E CSLL S/ NF 1126 RTS RIO S/A",
        Valor: -795.15,
        Data: date(2, 5),
      },
    ]);

    expect(result.notas.reduce((sum, item) => sum + item.faltaPagar, 0)).toBeCloseTo(294.66, 2);
    expect(result.notas.filter((item) => item.ignorarConsultaPagamento)).toHaveLength(2);
  });

'''
if tests.count(validation_marker) != 1:
    raise RuntimeError("Marcador dos testes de validação não encontrado exatamente uma vez")
tests = tests.replace(validation_marker, new_validation_tests + validation_marker, 1)

payment_marker = '''  it("trata fornecedor totalmente diferente como não localizado", () => {'''
new_payment_tests = '''  it("bloqueia pagamento incompatível antes de criar saldo negativo", () => {
    const current = nota({
      fornecedor: "JD AZEVEDO SERVICOS MEDICOS LTDA",
      notaFiscal: "340",
      valorNF: 5600,
      faltaPagar: 5432,
    });
    const rows = [pagamento("340", date(30, 5), 35680.87, date(30, 5), "JD AZEVEDO SERVICOS MEDICOS LTDA")];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.faltaPagar).toBe(5432);
    expect(current.informacoes).toContain("valor é incompatível");
    expect(current.confiancaAssociacao).toBe("Manual");
  });

  it("compara pagamento com o valor líquido depois das retenções", () => {
    const result = transformRows([
      {
        "Descrição histórico": "VALOR NF - 9705-BIOVEP CONTROLE DE VETORES E PRAGAS LTDA",
        Valor: 680.37,
        Data: date(30, 4),
      },
      {
        "Descrição histórico": "VALOR INSS DE TERCEIROS S/ NF - 9705-BIOVEP CONTROLE DE VETORES E PRAGAS LTDA",
        Valor: -74.84,
        Data: date(30, 4),
      },
    ]);
    const current = result.notas[0];
    const rows = [pagamento("9705", date(30, 5), 605.53, date(30, 5), "BIOVEP CONTROLE DE VETORES E PRAGAS LTDA")];

    applyPagamentosPdf([current], rows, {
      mesConferencia: { ano: 2026, mes: 5 },
      generatedAt: date(22, 7),
    });

    expect(current.informacoes).not.toContain("Pagou R$ 74,84 a menos");
    expect(current.informacoes).toContain("ERP indica pagamento integral");
  });

'''
if tests.count(payment_marker) != 1:
    raise RuntimeError("Marcador dos testes de pagamento não encontrado exatamente uma vez")
tests = tests.replace(payment_marker, new_payment_tests + payment_marker, 1)

TEST_PATH.write_text(tests, encoding="utf-8")
print("Patch aplicado com sucesso.")
