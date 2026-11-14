// «المطبخ» ingredient table. Every quantity in a recipe is the weight you put on the scale BEFORE cooking
// (state says which: نيّ / جاف / معلّب مصفّى). Values per 100 g, or per piece when unit is 'pc'.
// Sources: USDA FoodData Central reference values, rounded. Edit here only; recipes never carry their own macros.
const g = (id, name, kcal, p, c, f, o = {}) => ({ id, name, unit: 'g', per: 100, kcal, p, c, f, ...o });
const pc = (id, name, kcal, p, c, f, o = {}) => ({ id, name, unit: 'pc', per: 1, kcal, p, c, f, ...o });

export const INGREDIENTS = Object.freeze([
  // بروتين
  g('chicken', 'صدور فراخ', 120, 22.5, 0, 2.6, { state: 'نيّ', group: 'بروتين', pack: 1000 }),
  g('thigh', 'أوراك فراخ مخلية', 121, 19.7, 0, 4.1, { state: 'نيّ', group: 'بروتين', pack: 1000 }),
  g('beef', 'لحمة مفرومة قليلة الدهن', 176, 20, 0, 10, { state: 'نيّ', group: 'بروتين', pack: 500 }),
  pc('egg', 'بيض', 72, 6.3, 0.4, 4.8, { word: 'بيضة', group: 'بروتين', pack: 30 }),
  g('sardine', 'سردين معلّب', 208, 24.6, 0, 11.5, { state: 'مصفّى', group: 'بروتين', pack: 90 }),
  g('tuna', 'تونة معلّبة في مية', 116, 25.5, 0, 0.8, { state: 'مصفّاة', group: 'بروتين', pack: 120 }),
  pc('whey', 'واي بروتين', 120, 24, 3, 2, { word: 'سكوب', group: 'بروتين' }),
  // نشويات
  g('rice', 'رز أبيض', 365, 7.1, 80, 0.7, { state: 'جاف', group: 'نشويات', pack: 2000 }),
  g('riceflour', 'دقيق رز', 366, 6, 80, 1.4, { group: 'نشويات', pack: 1000 }),
  g('oats', 'شوفان', 389, 16.9, 66.3, 6.9, { state: 'جاف', group: 'نشويات', pack: 1000 }),
  g('pasta', 'مكرونة', 371, 13, 75, 1.5, { state: 'جافة', group: 'نشويات', pack: 400 }),
  g('potato', 'بطاطس', 77, 2, 17, 0.1, { state: 'نيّة', group: 'نشويات', pack: 1000 }),
  g('sweetpotato', 'بطاطا حلوة', 86, 1.6, 20, 0.1, { state: 'نيّة', group: 'نشويات', pack: 1000 }),
  pc('bread', 'عيش بلدي', 245, 9, 49.5, 1.1, { word: 'رغيف', group: 'نشويات', pack: 5 }),
  pc('tortilla', 'عيش تورتيلا', 218, 5.8, 36.4, 5.6, { word: 'رغيف', group: 'نشويات', pack: 8 }),
  g('lentil', 'عدس أصفر', 358, 24, 63, 2, { state: 'جاف', group: 'نشويات', pack: 1000 }),
  g('foul', 'فول مدمس معلّب', 110, 7.9, 19.7, 0.4, { group: 'نشويات', pack: 400 }),
  // ألبان
  g('milkpowder', 'لبن بودرة كامل الدسم', 496, 26.3, 38.4, 26.7, { group: 'ألبان', pack: 2000 }),
  g('greek', 'زبادي يوناني 0%', 59, 10.2, 3.6, 0.4, { group: 'ألبان', pack: 500 }),
  g('yogurt', 'زبادي عادي', 61, 3.5, 4.7, 3.3, { group: 'ألبان', pack: 400 }),
  g('feta', 'جبنة بيضاء', 264, 14.2, 4.1, 21.3, { group: 'ألبان', pack: 500 }),
  // دهون
  g('oil', 'زيت', 884, 0, 0, 100, { group: 'دهون', note: 'ملعقة صغيرة = 5 جم', pack: 750 }),
  g('pb', 'زبدة فول سوداني', 597, 25.1, 20.1, 51.4, { group: 'دهون', note: 'ملعقة كبيرة = 15 جم', pack: 340 }),
  // خضار وفاكهة
  g('tomato', 'طماطم', 18, 0.9, 3.9, 0.2, { group: 'خضار وفاكهة' }),
  g('onion', 'بصل', 40, 1.1, 9.3, 0.1, { group: 'خضار وفاكهة' }),
  g('pepper', 'فلفل ألوان', 26, 1, 6, 0.3, { group: 'خضار وفاكهة' }),
  g('cucumber', 'خيار', 15, 0.7, 3.6, 0.1, { group: 'خضار وفاكهة' }),
  g('veg', 'خضار مشكل مجمد', 65, 3.3, 13, 0.5, { group: 'خضار وفاكهة', pack: 400 }),
  g('paste', 'صلصة طماطم مركزة', 82, 4.3, 19, 0.5, { group: 'خضار وفاكهة', note: 'ملعقة كبيرة = 15 جم', pack: 135 }),
  pc('banana', 'موز', 105, 1.3, 27, 0.4, { word: 'موزة', group: 'خضار وفاكهة' }),
  pc('apple', 'تفاح', 95, 0.5, 25.1, 0.3, { word: 'تفاحة', group: 'خضار وفاكهة' }),
  g('dates', 'تمر منزوع النوى', 282, 2.5, 75, 0.4, { group: 'خضار وفاكهة', pack: 500 }),
  // تحلية
  g('honey', 'عسل', 304, 0.3, 82, 0, { group: 'تحلية', note: 'ملعقة صغيرة = 7 جم', pack: 500 }),
  g('cocoa', 'كاكاو خام', 228, 19.6, 20.9, 13.7, /* carbs net of 37 g fibre */ { group: 'تحلية', note: 'ملعقة كبيرة = 5 جم', pack: 200 }),
]);

export const ING = Object.freeze(Object.fromEntries(INGREDIENTS.map((i) => [i.id, i])));
export const ING_GROUPS = Object.freeze(['بروتين', 'نشويات', 'ألبان', 'دهون', 'خضار وفاكهة', 'تحلية']);
