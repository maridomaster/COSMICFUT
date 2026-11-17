// Casamento de nomes do pipeline de fotos (photos.mjs): jogador do jogo × elenco do Wikidata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, playerKey, nameLevel, matchPlayer, clubSimilarity, normalizeLicense } from '../src/photos.mjs';

const P = (qid, labels, birth = null) => ({ qid, labels, births: birth ? [birth] : [] });

test('normalizeName / playerKey: acentos, letras especiais e pontuação', () => {
  assert.equal(normalizeName('Rúben Dias'), 'ruben dias');
  assert.equal(normalizeName('Martin Ødegaard'), 'martin odegaard');
  assert.equal(normalizeName('Vini Jr.'), 'vini jr');
  assert.equal(normalizeName('İlkay Gündoğan'), 'ilkay gundogan');
  assert.equal(normalizeName('Kiernan Dewsbury-Hall'), 'kiernan dewsbury hall');
  assert.equal(playerKey('realmadrid-esp', 'Vinícius Júnior'), 'realmadrid-esp|vinicius junior');
});

test('nameLevel: idêntico, composto, apelido de uma palavra', () => {
  assert.equal(nameLevel('Vini Jr.', ['Vinícius Júnior', 'Vini Jr.']), 3);
  assert.equal(nameLevel('Rúben Dias', ['Rúben dos Santos Gato Alves Dias']), 2);
  assert.equal(nameLevel('Rúben dos Santos Gato Alves Dias', ['Ruben Dias']), 2);
  assert.equal(nameLevel('Bakasetas', ['Anastasios Bakasetas']), 1);
  assert.equal(nameLevel('Silva', ['Bernardo Silva']), 1);
  assert.equal(nameLevel('Rui', ['Rui Patrício']), 0); // curto demais para casar por token
  assert.equal(nameLevel('João Silva', ['Bernardo Silva']), 0);
});

test('matchPlayer: candidato único, empate = ambíguo, idade elimina', () => {
  const roster = [
    P('Q1', ['Erling Haaland', 'Erling Braut Haaland'], '2000-07-21'),
    P('Q2', ['Bernardo Silva', 'Bernardo Mota Veiga de Carvalho e Silva'], '1994-08-10'),
    P('Q3', ['João Cancelo'], '1994-05-27'),
    P('Q4', ['Allan', 'Allan Marques Loureiro'], '1991-01-08'),
  ];
  assert.equal(matchPlayer('Erling Haaland', 26, roster).person?.qid, 'Q1');
  assert.equal(matchPlayer('Allan', 30, roster).person?.qid, 'Q4');
  // idade real 25, jogo 40 → fora da janela
  assert.equal(matchPlayer('Erling Haaland', 40, roster).person, null);
  // "Silva" (1 palavra) casa só um candidato → aceita no nível 1
  assert.equal(matchPlayer('Silva', 30, roster).person?.qid, 'Q2');
  // dois "Silva" → ambíguo
  const two = [...roster, P('Q5', ['Thiago Silva'], '1984-09-22')];
  const r = matchPlayer('Silva', 32, two);
  assert.equal(r.person, null);
  assert.equal(r.ambiguous, 2);
  // nome exato vence token solto
  assert.equal(matchPlayer('Thiago Silva', 38, two).person?.qid, 'Q5');
  // sem data de nascimento: só nível ≥ 2
  assert.equal(matchPlayer('Bakasetas', 30, [P('Q9', ['Anastasios Bakasetas'])]).person, null);
  assert.equal(matchPlayer('Anastasios Bakasetas', 30, [P('Q9', ['Anastasios Bakasetas'])]).person?.qid, 'Q9');
});

test('clubSimilarity e licenças', () => {
  assert.ok(clubSimilarity('Real Madrid', 'Real Madrid CF') >= 0.9);
  assert.ok(clubSimilarity('Machester City', 'Manchester City F.C.') >= 0.6);
  assert.ok(clubSimilarity('Real Madrid', 'Atlético Madrid') < 0.7);
  assert.equal(normalizeLicense('CC BY-SA 4.0'), 'CC BY-SA 4.0');
  assert.equal(normalizeLicense('Public domain'), 'Public domain');
  assert.equal(normalizeLicense('CC0'), 'CC0');
  assert.equal(normalizeLicense('Fair use'), null);
});
