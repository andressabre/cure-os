#!/bin/sh
# Valida um XML de lote contra os XSD oficiais da ANS (TISS 4.03.00).
# Uso: ./validar-xml-tiss.sh <pasta-dos-xsd> <arquivo.xml>
# Os XSD vêm do pacote oficial da ANS (gov.br/ans → Padrão TISS → Comunicação 4.03.00);
# tissGuiasV4_03_00.xsd oficial tem SHA-256 587f0b6bac24175c50635ede52356cab00ff1ae28b550adc42e3a7f03cf605c7.
xmllint --noout --schema "$1/tissV4_03_00.xsd" "$2"
