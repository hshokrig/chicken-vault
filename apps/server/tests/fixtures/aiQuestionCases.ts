export interface AiQuestionCase {
  id: string;
  secretCard: string;
  transcript: string;
  expectShouldRespond: boolean;
  expectedAnswer: 'YES' | 'NO' | null;
}

export interface AiQuestionRound {
  round: string;
  card: string;
  cases: AiQuestionCase[];
}

export const AI_QUESTION_ROUNDS: AiQuestionRound[] = [
  {
    round: 'Round 1',
    card: 'QD',
    cases: [
      {
        id: 'r1-q1',
        secretCard: 'QD',
        transcript: 'Uh, okay, is the card red?',
        expectShouldRespond: true,
        expectedAnswer: 'YES'
      },
      {
        id: 'r1-q2',
        secretCard: 'QD',
        transcript: 'Is it spades or clubs?',
        expectShouldRespond: true,
        expectedAnswer: 'NO'
      },
      {
        id: 'r1-q3',
        secretCard: 'QD',
        transcript: 'haha wow that was loud, pass the water bottle, thanks',
        expectShouldRespond: false,
        expectedAnswer: null
      }
    ]
  },
  {
    round: 'Round 2',
    card: '7S',
    cases: [
      {
        id: 'r2-q1',
        secretCard: '7S',
        transcript: 'Is it black?',
        expectShouldRespond: true,
        expectedAnswer: 'YES'
      },
      {
        id: 'r2-q2',
        secretCard: '7S',
        transcript: 'Is the rank above ten?',
        expectShouldRespond: true,
        expectedAnswer: 'NO'
      },
      {
        id: 'r2-q3',
        secretCard: '7S',
        transcript: 'Everyone chill, okay next turn maybe',
        expectShouldRespond: false,
        expectedAnswer: null
      }
    ]
  },
  {
    round: 'Round 3',
    card: 'AC',
    cases: [
      {
        id: 'r3-q1',
        secretCard: 'AC',
        transcript: 'Is it an ace?',
        expectShouldRespond: true,
        expectedAnswer: 'YES'
      },
      {
        id: 'r3-q2',
        secretCard: 'AC',
        transcript: 'Is this a face card?',
        expectShouldRespond: true,
        expectedAnswer: 'NO'
      },
      {
        id: 'r3-q3',
        secretCard: 'AC',
        transcript: 'laughter and random talking over each other',
        expectShouldRespond: false,
        expectedAnswer: null
      }
    ]
  }
];

export const AI_QUESTION_CASES: AiQuestionCase[] = AI_QUESTION_ROUNDS.flatMap((round) => round.cases);
