import { describe, expect, it } from 'vitest';
import {
  trainingSource,
  sanitizeUploadName,
  trainingTitle,
  buildInterviewPrompt,
  parseInterviewQuestions,
  buildQaTrainingDoc,
  INTERVIEW_MAX_Q,
} from '../src/ai-train';

describe('trainingSource', () => {
  it('mode only when no ref', () => {
    expect(trainingSource('text')).toBe('train:text');
  });
  it('sanitizes + caps the ref', () => {
    expect(trainingSource('audio', 'My File (1).mp3')).toBe(
      'train:audio:MyFile1.mp3',
    );
    expect(trainingSource('call', 'sess id/../x')).toBe(
      'train:call:sessid..x',
    );
  });
});

describe('sanitizeUploadName', () => {
  it('strips path + unusual chars; never empty', () => {
    expect(sanitizeUploadName('/tmp/a/b/Recording 7.wav')).toBe(
      'Recording 7.wav',
    );
    expect(sanitizeUploadName('C:\\\\x\\\\y.mp3')).toBe('y.mp3');
    expect(sanitizeUploadName('')).toBe('audio');
    expect(sanitizeUploadName(null as unknown as string)).toBe(
      'audio',
    );
    expect(sanitizeUploadName('***')).toBe('audio');
  });
});

describe('trainingTitle', () => {
  it('labels per mode + appends a trimmed hint', () => {
    expect(trainingTitle('text')).toBe('Training note');
    expect(trainingTitle('audio', '  call  log  ')).toBe(
      'Audio training: call log',
    );
    expect(trainingTitle('interview', 'x'.repeat(300)).length).toBe(
      'Interview answer: '.length + 120,
    );
  });
});

describe('buildInterviewPrompt', () => {
  it('caps n, lists known topics, defaults area', () => {
    const p = buildInterviewPrompt('Billing', ['Refund policy'], 50);
    expect(p).toContain('area: Billing');
    expect(p).toContain(`exactly ${INTERVIEW_MAX_Q} short`);
    expect(p).toContain('- Refund policy');
    expect(p).toContain('Do NOT ask about');
  });
  it('no known topics -> "start with essentials"', () => {
    const p = buildInterviewPrompt('', [], 3);
    expect(p).toContain('general customer support');
    expect(p).toContain('exactly 3 short');
    expect(p).toContain('currently knows nothing');
  });
});

describe('parseInterviewQuestions', () => {
  it('strips numbering / bullets / Q: and de-dupes', () => {
    const out = parseInterviewQuestions(
      [
        '1. What is the refund window?',
        '- What is the refund window?',
        '• How do we verify identity?',
        'Q: When do we escalate?',
        '   ',
        'ok', // too short
        'Preamble here is also a line that stays',
      ].join('\n'),
    );
    expect(out).toEqual([
      'What is the refund window?',
      'How do we verify identity?',
      'When do we escalate?',
      'Preamble here is also a line that stays',
    ]);
  });
  it('caps + handles junk', () => {
    expect(parseInterviewQuestions(null as unknown as string)).toEqual(
      [],
    );
    const many = Array.from({ length: 30 }, (_, i) => `Question ${i}?`).join(
      '\n',
    );
    expect(parseInterviewQuestions(many, 5)).toHaveLength(5);
  });
});

describe('buildQaTrainingDoc', () => {
  it('formats Q/A; blank answer -> empty', () => {
    expect(buildQaTrainingDoc('How?', '  do X then Y ')).toBe(
      'Q: How?\nA: do X then Y',
    );
    expect(buildQaTrainingDoc('How?', '   ')).toBe('');
    expect(buildQaTrainingDoc('', 'just an answer')).toBe(
      'just an answer',
    );
  });
});
