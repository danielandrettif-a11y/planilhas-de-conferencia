/** Linhas de conferência na ordem do modelo contábil. Encargos empresariais
 * permanecem em branco até que a origem dos valores seja definida. */
export interface LinhaModeloFolha {
  descricao: string; debito: string; credito: string; coluna: string;
  historico: (mes:string)=>string; valorExterno?: boolean;
}
export const modeloFolha: LinhaModeloFolha[] = [
  {descricao:"ORDENADOS",debito:"1981",credito:"1239",coluna:"A",historico:m=>`VR. BRUTO ORDENADO REF. MÊS ${m} CONF. FOLHA DE PAGAMENTO`},
  {descricao:"SALÁRIO-MATERNIDADE",debito:"6452",credito:"1239",coluna:"B",historico:m=>`VR. SALÁRIO MATERNIDADE REF. MÊS ${m} CONF. FOLHA DE PAGTO.`},
  {descricao:"TRANSFERÊNCIA SALÁRIO-MATERNIDADE",debito:"1274",credito:"6452",coluna:"B",historico:m=>`VR. QUE SE TRANSFERE REF. SALÁRIO MATERNIDADE MÊS ${m} CONF. FOLHA DE PAGTO.`},
  {descricao:"SALÁRIO-FAMÍLIA",debito:"6445",credito:"1239",coluna:"C",historico:m=>`VR. SALARIO-FAMILIA REF. MÊS ${m} CONF. FOLHA DE PAGAMENTO`},
  {descricao:"TRANSFERÊNCIA SALÁRIO-FAMÍLIA",debito:"1274",credito:"6445",coluna:"C",historico:m=>`VR. QUE SE TRANSFERE REF. SALARIO-FAMILIA MÊS ${m} CONF. FOLHA DE PAGAMENTO`},
  {descricao:"FALTAS",debito:"1239",credito:"1981",coluna:"E",historico:m=>`VR. REF. FALTAS DOS FUNCIONARIOS MÊS ${m} CONF. FOLHA DE PAGAMENTO.`},
  {descricao:"SEGURO DE VIDA",debito:"1239",credito:"6438",coluna:"J",historico:m=>`VR. SEGURO DE VIDA REF. MÊS ${m} CONF. FOLHA DE PAGAMENTO`},
  {descricao:"ALIMENTAÇÃO",debito:"1239",credito:"1981",coluna:"N",historico:m=>`VR. REF. ALIMENTAÇÃO, CONF. FOLHA DE PAGAMENTO MÊS ${m}`},
  {descricao:"PENSÃO A RECOLHER",debito:"1239",credito:"1307",coluna:"I",historico:m=>`VR. REF. PENSÃO A RECOLHER MÊS ${m} CONF. FOLHA DE PAGAMENTO.`},
  {descricao:"VALE-TRANSPORTE",debito:"1239",credito:"2037",coluna:"L",historico:m=>`VR. REF. RECUPERAÇÕES DE VALE-TRANSPORTE MÊS ${m} CONF. FOLHA PAGAMENTO`},
  {descricao:"RECEBIDOS",debito:"1239",credito:"1981",coluna:"K",historico:m=>`VR. RECEBIDO CONF. FOLHA DE PAGTO MÊS ${m}`},
  {descricao:"CONTRIBUIÇÃO SINDICAL",debito:"1239",credito:"1288",coluna:"H",historico:m=>`VR. CONTR. SINDICAL REF. MÊS ${m} CONF. FOLHA DE PAGAMENTO.`},
  {descricao:"ASSOCIADOS AO SINDICATO",debito:"1239",credito:"6431",coluna:"G",historico:m=>`VR. REF. ASSOCIADOS AO SINDICATO MÊS ${m} CONF. FOLHA DE PAGAMENTO`},
  {descricao:"FARMÁCIA",debito:"1239",credito:"9574",coluna:"M",historico:m=>`VR. DESCONTADO REF. FARMACIA CONFORME FOLHA DE PAGTO MÊS ${m}`},
  {descricao:"PLANO DE SAÚDE",debito:"1239",credito:"12640",coluna:"D",historico:m=>`VR. DESCONTADO REF. PLANO DE SAÚDE MÊS ${m} CONFORME FOLHA DE PAGAMENTO.`},
  {descricao:"INSS DOS FUNCIONÁRIOS",debito:"1239",credito:"1274",coluna:"F",historico:m=>`VR. INSS A RECOLHER (EMPREGADO) REF. MÊS ${m} CONF. FOLHA DE PAGAMENTO`},
  {descricao:"IRRF SOBRE SALÁRIOS",debito:"1239",credito:"1162",coluna:"O",historico:m=>`VR. I.R.R.F. S/SALÁRIOS REF. MÊS ${m} CONF. FOLHA DE PAGAMENTO`},
  {descricao:"INSS/EMPRESA",debito:"2086",credito:"1274",coluna:"P",valorExterno:true,historico:m=>`VR. INSS/EMPRESA REF. MÊS ${m} CONF. GUIA`},
  {descricao:"FGTS",debito:"2093",credito:"1281",coluna:"Q",valorExterno:true,historico:m=>`VR. F.G.T.S. REF. MÊS ${m} CONF. GUIA`},
  {descricao:"DEVOLUÇÃO INSS",debito:"1274",credito:"1239",coluna:"R",historico:m=>`VR. BRUTO ORDENADO REF. DEVOLUÇÃO DE INSS MÊS ${m} CONF. FOLHA DE PAGAMENTO`},
  {descricao:"EMPRÉSTIMO CONSIGNADO SANTANDER",debito:"1239",credito:"1856",coluna:"T",historico:m=>`VALOR DESCONTADO DE EMPRESTIMO CONSIGNADO SANTANDER S/ FOLHA DE PAGTO DO MÊS ${m}`},
  {descricao:"EMPRÉSTIMO CONSIGNADO GOV",debito:"1239",credito:"83620",coluna:"S",historico:m=>`VALOR DESCONTADO DE EMPRESTIMO E-GOV S/ FOLHA DE PAGTO DO MÊS ${m}`},
];
