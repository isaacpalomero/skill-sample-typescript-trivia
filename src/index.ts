/* eslint-disable  func-names */
/* eslint-disable  no-console */

import { QUESTIONS } from "./questions";

const i18n = require("i18next");
import { Response, IntentRequest, Intent } from "ask-sdk-model";
import {
  SkillBuilders,
  RequestInterceptor,
  RequestHandler,
  HandlerInput,
  ErrorHandler,
} from "ask-sdk-core";
// tslint:disable-next-line: no-var-requires
// import i18next from "i18next";
import { getRandomItem } from "./lib/helpers";
import * as sprintf from "i18next-sprintf-postprocessor";
import { RequestAttributes } from "./interfaces";

const ANSWER_COUNT = 4;
const GAME_LENGTH = 5;

interface Question {
  [key: string]: string[];
}

function populateGameQuestions(translatedQuestions: Question[]) {
  const gameQuestionIndexes: number[] = [];
  const indexList: number[] = [];
  let index = translatedQuestions.length;
  if (GAME_LENGTH > index) {
    throw new Error("Invalid Game Length.");
  }

  for (let i = 0; i < translatedQuestions.length; i += 1) {
    indexList.push(i);
  }

  for (let j = 0; j < GAME_LENGTH; j += 1) {
    const rand = Math.floor(Math.random() * index);
    index -= 1;

    const tempIndex = indexList[index];
    indexList[index] = indexList[rand];
    indexList[rand] = tempIndex;
    gameQuestionIndexes.push(indexList[index]);
  }
  return gameQuestionIndexes;
}

function populateRoundAnswers(
  gameQuestionIndexes: number[],
  correctAnswerIndex: number,
  correctAnswerTargetLocation: number,
  translatedQuestions: Question[],
) {
  const answers = [];
  const translatedQuestion = translatedQuestions[gameQuestionIndexes[correctAnswerIndex]];
  const answersCopy = [...translatedQuestion[Object.keys(translatedQuestion)[0]]];
  let index = answersCopy.length;

  if (index < ANSWER_COUNT) {
    throw new Error("Not enough answers for question.");
  }

  // Shuffle the answers, excluding the first element which is the correct answer.
  for (let j = 1; j < answersCopy.length; j += 1) {
    const rand = Math.floor(Math.random() * (index - 1)) + 1;
    index -= 1;

    const swapTemp1 = answersCopy[index];
    answersCopy[index] = answersCopy[rand];
    answersCopy[rand] = swapTemp1;
  }

  // Swap the correct answer into the target location
  for (let i = 0; i < ANSWER_COUNT; i += 1) {
    answers[i] = answersCopy[i];
  }
  const swapTemp2 = answers[0];
  answers[0] = answers[correctAnswerTargetLocation];
  answers[correctAnswerTargetLocation] = swapTemp2;
  return answers;
}

function isAnswerSlotValid(intent: Intent) {
  if (intent.slots === undefined
    || intent.slots.Answer === undefined
    || intent.slots.Answer.value === undefined) {
    return false;
  }

  const answerSlotIsInt = !Number.isNaN(parseInt(intent.slots.Answer.value, 10));
  return answerSlotIsInt
    && parseInt(intent.slots.Answer.value, 10) < (ANSWER_COUNT + 1)
    && parseInt(intent.slots.Answer.value, 10) > 0;
}

function handleUserGuess(userGaveUp: boolean, handlerInput: HandlerInput) {
  const { requestEnvelope, attributesManager, responseBuilder } = handlerInput;
  const { intent } = requestEnvelope.request as IntentRequest;

  const answerSlotValid = isAnswerSlotValid(intent);

  let speechOutput = "";
  let speechOutputAnalysis = "";

  const sessionAttributes = attributesManager.getSessionAttributes();
  const gameQuestions = sessionAttributes.questions;
  let correctAnswerIndex = parseInt(sessionAttributes.correctAnswerIndex, 10);
  let currentScore = parseInt(sessionAttributes.score, 10);
  let currentQuestionIndex = parseInt(sessionAttributes.currentQuestionIndex, 10);
  const { correctAnswerText } = sessionAttributes;
  const requestAttributes = attributesManager.getRequestAttributes();
  const translatedQuestions = requestAttributes.t("QUESTIONS");

  if (answerSlotValid && parseInt(intent.slots!.Answer.value!, 10) === sessionAttributes.correctAnswerIndex) {
    currentScore += 1;
    speechOutputAnalysis = requestAttributes.t("ANSWER_CORRECT_MESSAGE");
  } else {
    if (!userGaveUp) {
      speechOutputAnalysis = requestAttributes.t("ANSWER_WRONG_MESSAGE");
    }

    speechOutputAnalysis += requestAttributes.t(
      "CORRECT_ANSWER_MESSAGE",
      correctAnswerIndex,
      correctAnswerText,
    );
  }

  // Check if we can exit the game session after GAME_LENGTH questions (zero-indexed)
  if (sessionAttributes.currentQuestionIndex === GAME_LENGTH - 1) {
    speechOutput = userGaveUp ? "" : requestAttributes.t("ANSWER_IS_MESSAGE");
    speechOutput += speechOutputAnalysis + requestAttributes.t(
      "GAME_OVER_MESSAGE",
      currentScore.toString(),
      GAME_LENGTH.toString(),
    );

    return responseBuilder
      .speak(speechOutput)
      .getResponse();
  }
  currentQuestionIndex += 1;
  correctAnswerIndex = Math.floor(Math.random() * (ANSWER_COUNT));
  const spokenQuestion = Object.keys(translatedQuestions[gameQuestions[currentQuestionIndex]])[0];
  const roundAnswers = populateRoundAnswers(
    gameQuestions,
    currentQuestionIndex,
    correctAnswerIndex,
    translatedQuestions,
  );
  const questionIndexForSpeech = currentQuestionIndex + 1;
  let repromptText = requestAttributes.t(
    "TELL_QUESTION_MESSAGE",
    questionIndexForSpeech.toString(),
    spokenQuestion,
  );

  for (let i = 0; i < ANSWER_COUNT; i += 1) {
    repromptText += `${i + 1}. ${roundAnswers[i]}. `;
  }

  speechOutput += userGaveUp ? "" : requestAttributes.t("ANSWER_IS_MESSAGE");
  speechOutput += speechOutputAnalysis
    + requestAttributes.t("SCORE_IS_MESSAGE", currentScore.toString())
    + repromptText;

  const translatedQuestion = translatedQuestions[gameQuestions[currentQuestionIndex]];

  Object.assign(sessionAttributes, {
    speechOutput: repromptText,
    repromptText,
    currentQuestionIndex,
    correctAnswerIndex: correctAnswerIndex + 1,
    questions: gameQuestions,
    score: currentScore,
    correctAnswerText: translatedQuestion[Object.keys(translatedQuestion)[0]][0],
  });

  return responseBuilder.speak(speechOutput)
    .reprompt(repromptText)
    .withSimpleCard(requestAttributes.t("GAME_NAME"), repromptText)
    .getResponse();
}

function startGame(newGame: boolean, handlerInput: HandlerInput) {
  const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
  let speechOutput = newGame
    ? requestAttributes.t("NEW_GAME_MESSAGE", requestAttributes.t("GAME_NAME"))
    + requestAttributes.t("WELCOME_MESSAGE", GAME_LENGTH.toString())
    : "";
  const translatedQuestions = requestAttributes.t("QUESTIONS");
  const gameQuestions = populateGameQuestions(translatedQuestions);
  const correctAnswerIndex = Math.floor(Math.random() * (ANSWER_COUNT));

  const roundAnswers = populateRoundAnswers(
    gameQuestions,
    0,
    correctAnswerIndex,
    translatedQuestions,
  );
  const currentQuestionIndex = 0;
  const spokenQuestion = Object.keys(translatedQuestions[gameQuestions[currentQuestionIndex]])[0];
  let repromptText = requestAttributes.t("TELL_QUESTION_MESSAGE", "1", spokenQuestion);
  for (let i = 0; i < ANSWER_COUNT; i += 1) {
    repromptText += `${i + 1}. ${roundAnswers[i]}. `;
  }

  speechOutput += repromptText;
  const sessionAttributes = {};

  const translatedQuestion = translatedQuestions[gameQuestions[currentQuestionIndex]];

  Object.assign(sessionAttributes, {
    speechOutput: repromptText,
    repromptText,
    currentQuestionIndex,
    correctAnswerIndex: correctAnswerIndex + 1,
    questions: gameQuestions,
    score: 0,
    correctAnswerText: translatedQuestion[Object.keys(translatedQuestion)[0]][0],
  });

  handlerInput.attributesManager.setSessionAttributes(sessionAttributes);

  return handlerInput.responseBuilder
    .speak(speechOutput)
    .reprompt(repromptText)
    .withSimpleCard(requestAttributes.t("GAME_NAME"), repromptText)
    .getResponse();
}

function helpTheUser(newGame: boolean, handlerInput: HandlerInput) {
  const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
  const askMessage = newGame
    ? requestAttributes.t("ASK_MESSAGE_START")
    : requestAttributes.t("REPEAT_QUESTION_MESSAGE") + requestAttributes.t("STOP_MESSAGE");
  const speechOutput = requestAttributes.t("HELP_MESSAGE", GAME_LENGTH) + askMessage;
  const repromptText = requestAttributes.t("HELP_REPROMPT") + askMessage;

  return handlerInput.responseBuilder.speak(speechOutput).reprompt(repromptText).getResponse();
}

/* jshint -W101 */
const languageString = {
  "en": {
    translation: {
      QUESTIONS: QUESTIONS.EN_US,
      GAME_NAME: "Reindeer Trivia",
      HELP_MESSAGE: "I will ask you %s multiple choice questions. Respond with the number of the answer. For example, say one, two, three, or four. To start a new game at any time, say, start game. ",
      REPEAT_QUESTION_MESSAGE: "To repeat the last question, say, repeat. ",
      ASK_MESSAGE_START: "Would you like to start playing?",
      HELP_REPROMPT: "To give an answer to a question, respond with the number of the answer. ",
      STOP_MESSAGE: "Would you like to keep playing?",
      CANCEL_MESSAGE: "Ok, let's play again soon.",
      NO_MESSAGE: "Ok, we'll play another time. Goodbye!",
      TRIVIA_UNHANDLED: "Try saying a number between 1 and %s",
      HELP_UNHANDLED: "Say yes to continue, or no to end the game.",
      START_UNHANDLED: "Say start to start a new game.",
      NEW_GAME_MESSAGE: "Welcome to %s. ",
      WELCOME_MESSAGE: "I will ask you %s questions, try to get as many right as you can. Just say the number of the answer. Let's begin. ",
      ANSWER_CORRECT_MESSAGE: "correct. ",
      ANSWER_WRONG_MESSAGE: "wrong. ",
      CORRECT_ANSWER_MESSAGE: "The correct answer is %s: %s. ",
      ANSWER_IS_MESSAGE: "That answer is ",
      TELL_QUESTION_MESSAGE: "Question %s. %s ",
      GAME_OVER_MESSAGE: "You got %s out of %s questions correct. Thank you for playing!",
      SCORE_IS_MESSAGE: "Your score is %s. "
    },
  },
  "en-US": {
    translation: {
      QUESTIONS: QUESTIONS.EN_US,
      GAME_NAME: "American Reindeer Trivia"
    },
  },
  "en-GB": {
    translation: {
      QUESTIONS: QUESTIONS.EN_GB,
      GAME_NAME: "British Reindeer Trivia"
    },
  },
  "de": {
    translation: {
      QUESTIONS: QUESTIONS.DE_DE,
      GAME_NAME: "Wissenswertes über Rentiere in Deutsch",
      HELP_MESSAGE: "Ich stelle dir %s Multiple-Choice-Fragen. Antworte mit der Zahl, die zur richtigen Antwort gehört. Sage beispielsweise eins, zwei, drei oder vier. Du kannst jederzeit ein neues Spiel beginnen, sage einfach „Spiel starten“. ",
      REPEAT_QUESTION_MESSAGE: "Wenn die letzte Frage wiederholt werden soll, sage „Wiederholen“ ",
      ASK_MESSAGE_START: "Möchten Sie beginnen?",
      HELP_REPROMPT: "Wenn du eine Frage beantworten willst, antworte mit der Zahl, die zur richtigen Antwort gehört. ",
      STOP_MESSAGE: "Möchtest du weiterspielen?",
      CANCEL_MESSAGE: "OK, dann lass uns bald mal wieder spielen.",
      NO_MESSAGE: "OK, spielen wir ein andermal. Auf Wiedersehen!",
      TRIVIA_UNHANDLED: "Sagt eine Zahl beispielsweise zwischen 1 und %s",
      HELP_UNHANDLED: "Sage ja, um fortzufahren, oder nein, um das Spiel zu beenden.",
      START_UNHANDLED: "Du kannst jederzeit ein neues Spiel beginnen, sage einfach „Spiel starten“.",
      NEW_GAME_MESSAGE: "Willkommen bei %s. ",
      WELCOME_MESSAGE: "Ich stelle dir %s Fragen und du versuchst, so viele wie möglich richtig zu beantworten. Sage einfach die Zahl, die zur richtigen Antwort passt. Fangen wir an. ",
      ANSWER_CORRECT_MESSAGE: "Richtig. ",
      ANSWER_WRONG_MESSAGE: "Falsch. ",
      CORRECT_ANSWER_MESSAGE: "Die richtige Antwort ist %s: %s. ",
      ANSWER_IS_MESSAGE: "Diese Antwort ist ",
      TELL_QUESTION_MESSAGE: "Frage %s. %s ",
      GAME_OVER_MESSAGE: "Du hast %s von %s richtig beantwortet. Danke fürs Mitspielen!",
      SCORE_IS_MESSAGE: "Dein Ergebnis ist %s. "
    },
  },
};

type TranslationFunction = (...args: any[]) => string;

/**
 * Adds translation functions to the RequestAttributes.
 */
export class LocalizationInterceptor implements RequestInterceptor {
  public async process(handlerInput: HandlerInput): Promise<void> {
    const t = await i18n.use(sprintf).init({
      lng: handlerInput.requestEnvelope.request.locale,
      overloadTranslationOptionHandler:
        sprintf.overloadTranslationOptionHandler,
      resources: languageString,
      returnObjects: true,
    });

    const attributes = handlerInput.attributesManager.getRequestAttributes() as RequestAttributes;
    attributes.t = (...args: any[]) => {
      return (t as TranslationFunction)(...args);
    };
    attributes.tr = (key: any) => {
      const result = t(key) as string[];
      return getRandomItem(result);
    };
  }
}


class LaunchRequest implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    const { request } = handlerInput.requestEnvelope;

    return request.type === "LaunchRequest"
      || (request.type === "IntentRequest"
        && request.intent.name === "AMAZON.StartOverIntent");
  }
  public handle(handlerInput: HandlerInput): Response {
    return startGame(true, handlerInput);
  }
}

class HelpIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    const { request } = handlerInput.requestEnvelope;

    return request.type === "IntentRequest" && request.intent.name === "AMAZON.HelpIntent";
  }
  public handle(handlerInput: HandlerInput): Response {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

    const newGame = !(sessionAttributes.questions);
    return helpTheUser(newGame, handlerInput);
  }
}

class UnhandledIntent implements RequestHandler {
  public canHandle(_handlerInput: HandlerInput): boolean {
    return true;
  }
  public handle(handlerInput: HandlerInput): Response {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    if (Object.keys(sessionAttributes).length === 0) {
      const speechOutput1 = requestAttributes.t("START_UNHANDLED");
      return handlerInput.responseBuilder
        .speak(speechOutput1)
        .reprompt(speechOutput1)
        .getResponse();
    } else if (sessionAttributes.questions) {
      const speechOutput2 = requestAttributes.t("TRIVIA_UNHANDLED", ANSWER_COUNT.toString());
      return handlerInput.responseBuilder
        .speak(speechOutput2)
        .reprompt(speechOutput2)
        .getResponse();
    }
    const speechOutput3 = requestAttributes.t("HELP_UNHANDLED");
    return handlerInput.responseBuilder
      .speak(speechOutput3)
      .reprompt(speechOutput3)
      .getResponse();
  }
}

class SessionEndedRequest implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    const request = handlerInput.requestEnvelope.request;
    return request.type === "SessionEndedRequest";
  }
  public handle(handlerInput: HandlerInput): Response {
    if (handlerInput.requestEnvelope.request.type === "SessionEndedRequest") {
      const request = handlerInput.requestEnvelope.request;
      console.log(`Session ended with reason: ${request.reason}`);
    }
    return handlerInput.responseBuilder.getResponse();
  }
}

class AnswerIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    return handlerInput.requestEnvelope.request.type === "IntentRequest"
      && (handlerInput.requestEnvelope.request.intent.name === "AnswerIntent"
        || handlerInput.requestEnvelope.request.intent.name === "DontKnowIntent");
  }
  public handle(handlerInput: HandlerInput): Response {
    const { intent } = handlerInput.requestEnvelope.request as IntentRequest;
    if (intent.name === "AnswerIntent") {
      return handleUserGuess(false, handlerInput);
    }
    return handleUserGuess(true, handlerInput);
  }
}

class RepeatIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    return handlerInput.requestEnvelope.request.type === "IntentRequest"
      && handlerInput.requestEnvelope.request.intent.name === "AMAZON.RepeatIntent";
  }
  public handle(handlerInput: HandlerInput): Response {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    return handlerInput.responseBuilder.speak(sessionAttributes.speechOutput)
      .reprompt(sessionAttributes.repromptText)
      .getResponse();
  }
}

class YesIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    return handlerInput.requestEnvelope.request.type === "IntentRequest"
      && handlerInput.requestEnvelope.request.intent.name === "AMAZON.YesIntent";
  }
  public handle(handlerInput: HandlerInput): Response {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    if (sessionAttributes.questions) {
      return handlerInput.responseBuilder.speak(sessionAttributes.speechOutput)
        .reprompt(sessionAttributes.repromptText)
        .getResponse();
    }
    return startGame(false, handlerInput);
  }
}

class StopIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    return handlerInput.requestEnvelope.request.type === "IntentRequest"
      && handlerInput.requestEnvelope.request.intent.name === "AMAZON.StopIntent";
  }
  public handle(handlerInput: HandlerInput): Response {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const speechOutput = requestAttributes.t("STOP_MESSAGE");

    return handlerInput.responseBuilder.speak(speechOutput)
      .reprompt(speechOutput)
      .getResponse();
  }
}

class CancelIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    return handlerInput.requestEnvelope.request.type === "IntentRequest"
      && handlerInput.requestEnvelope.request.intent.name === "AMAZON.CancelIntent";
  }
  public handle(handlerInput: HandlerInput): Response {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const speechOutput = requestAttributes.t("CANCEL_MESSAGE");

    return handlerInput.responseBuilder.speak(speechOutput)
      .getResponse();
  }
}

class NoIntent implements RequestHandler {
  public canHandle(handlerInput: HandlerInput): boolean {
    return handlerInput.requestEnvelope.request.type === "IntentRequest"
      && handlerInput.requestEnvelope.request.intent.name === "AMAZON.NoIntent";
  }
  public handle(handlerInput: HandlerInput): Response {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    const speechOutput = requestAttributes.t("NO_MESSAGE");
    return handlerInput.responseBuilder.speak(speechOutput).getResponse();
  }
}

class CustomErrorHandler implements ErrorHandler {
  public canHandle(_handlerInput: HandlerInput): boolean {
    return true;
  }
  public handle(handlerInput: HandlerInput, error: Error): Response {
    console.log(`Error handled: ${error.message}`);

    return handlerInput.responseBuilder
      .speak("Sorry, I can't understand the command. Please say again.")
      .reprompt("Sorry, I can't understand the command. Please say again.")
      .getResponse();
  }
}

const skillBuilder = SkillBuilders.custom();
exports.handler = skillBuilder
  .addRequestHandlers(
    new LaunchRequest(),
    new HelpIntent(),
    new AnswerIntent(),
    new RepeatIntent(),
    new YesIntent(),
    new StopIntent(),
    new CancelIntent(),
    new NoIntent(),
    new SessionEndedRequest(),
    new UnhandledIntent(),
  )
  .addRequestInterceptors(new LocalizationInterceptor())
  .addErrorHandlers(new CustomErrorHandler())
  .lambda();
