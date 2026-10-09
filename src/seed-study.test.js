import test from 'node:test';
import assert from 'node:assert/strict';
import { seedVocabulary } from './seed-vocabulary.js';
import { seedStudyBanks } from './seed-study.js';

test('starter vocabulary has distinct bilingual entries and original examples in each learning direction', () => {
  assert.equal(seedVocabulary.length, 90);
  assert.equal(new Set(seedVocabulary.map(word => word.en)).size, 90);
  for (const track of ['english','postgraduate','ielts']) {
    assert.equal(seedVocabulary.filter(word => word.track === track).length, 30);
  }
  for (const word of seedVocabulary) {
    assert.ok(word.zh && word.en && word.partOfSpeech && word.exampleEn && word.exampleZh, word.en);
    assert.ok(word.exampleEn.toLowerCase().includes(word.en), `Missing example usage: ${word.en}`);
    assert.equal(word.reviewStatus, 'approved');
    assert.ok(word.source && word.license);
  }
});

test('original reading banks keep coherent reading groups and complete deterministic answers', () => {
  assert.equal(seedStudyBanks.length, 4);
  assert.equal(new Set(seedStudyBanks.map(bank => bank.seedKey)).size, 4);
  assert.equal(seedStudyBanks.flatMap(bank => bank.questions).length, 12);
  for (const bank of seedStudyBanks) {
    assert.ok(bank.sourceName && bank.license && bank.category);
    assert.equal(bank.questions.length, 3);
    for (const question of bank.questions) {
      assert.equal(question.groupId, bank.seedKey);
      assert.ok(question.materialTitle && question.materialText.length > 300 && question.explanation);
      if (question.type === 'fill') {
        assert.equal(question.blanks.length, 1);
        assert.deepEqual(question.answer, question.blanks.map(blank => blank.answers));
        for (const answer of question.blanks[0].answers) {
          assert.ok(question.materialText.toLowerCase().includes(answer), `Fill answer absent from source: ${answer}`);
        }
      } else {
        assert.ok(['choice','multiple'].includes(question.type));
        assert.ok(question.options.length >= 3);
        const answers = Array.isArray(question.answer) ? question.answer : [question.answer];
        assert.equal(new Set(answers).size, answers.length);
        assert.ok(answers.every(answer => Number.isInteger(answer) && answer >= 0 && answer < question.options.length));
      }
    }
  }
});
