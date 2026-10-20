/**
 * Every outbound wording lives here so the sales copy can be edited without
 * touching the flow logic.
 */

export const IG_WELCOME = `שלום! תודה שפנית 🙌
מסלול הלימודים ב-EMP School הוא מסלול מעשי שמלווה אותך צעד אחר צעד, עם תרגול אמיתי וליווי אישי לאורך כל הדרך.

כדי שאוכל לשלוח לך את כל הפרטים ולתאם שיחה קצרה, אשמח למספר הטלפון שלך 📱`;

export const IG_PHONE_RECEIVED = `מעולה, קיבלתי את המספר שלך.
אשלח לך עכשיו הודעה בוואטסאפ כדי לתאם שיחה קצרה. נדבר בקרוב!`;

/**
 * Used when WhatsApp is not connected yet. Promising a WhatsApp message we
 * cannot send would be a broken promise, so the wording stays neutral.
 */
export const IG_PHONE_RECEIVED_NO_WHATSAPP = `מעולה, קיבלתי את המספר שלך.
אחזור אליך בהקדם כדי לתאם שיחה קצרה. נדבר בקרוב!`;

export const WA_FIRST_CONTACT = `היי, זה אייל מ-EMP School. קיבלתי את הפרטים שלך דרך האינסטגרם לגבי מסלול הלימודים. פנוי במקרה לשיחה קצרה?`;

export const WA_ASK_WHEN = `אין בעיה 🙂 מתי יהיה לך נוח שאתקשר?`;

export const WA_CONFIRM_AVAILABLE = `מעולה, מתקשר אליך עוד רגע.`;

export const waConfirmScheduled = (whenText) => `סגור, רשמתי לעצמי ${whenText}. נדבר אז!`;
