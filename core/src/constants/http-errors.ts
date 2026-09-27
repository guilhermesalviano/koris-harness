export const HTTP_ERROR_MESSAGES: Record<number, string> = {
  400: "Oops! My circuits got a bit confused by that request. Could you double-check it and try again?",
  401: "Hmm, it looks like I don't have your magic API key! Please check your authentication so we can get started.",
  403: "Oh no, I'm not allowed to go in there! Please make sure you have the right permissions to access this.",
  404: "I searched through all my digital files, but I just couldn't find that model or endpoint.",
  408: "Thinking... thinking... oh, that took a bit too long! Let's try sending that request one more time.",
  429: "Whoa, so many requests! I need a tiny breather to catch up. Please try again in just a moment!",
  500: "Yikes, I had a little brain freeze! Something went wrong on the server, but please try again later.",
  502: "Uh-oh, my connection to the AI provider hit a bump in the road. Let's try again in a few minutes!",
  503: "I'm currently taking a quick nap or feeling a bit overwhelmed. I'll be back and ready to help you very soon!",
  504: "My provider took a little too long to reply to me. Let's give them a nudge and try again!",
};

export const NOT_AUTHORIZED_PERMISSION = "I can only provide text-only help for this WhatsApp account. Tool-based actions are limited to authorized users."