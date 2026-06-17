const db = require("./db");

function seed() {
  const existingFamily = db.prepare("SELECT id FROM families LIMIT 1").get();
  if (existingFamily) {
    console.log("数据库已存在数据，跳过种子填充");
    return;
  }

  const insertFamily = db.prepare(`
    INSERT INTO families (name, origin_place, description)
    VALUES (?, ?, ?)
  `);

  const insertMember = db.prepare(`
    INSERT INTO members (family_id, name, gender, generation, parent_id, birth_year, death_year, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertHeirloom = db.prepare(`
    INSERT INTO heirlooms (family_id, name, era, origin, photo_description, current_holder_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertNarrative = db.prepare(`
    INSERT INTO narratives (heirloom_id, title, content, narrator_name, narrator_relation, narrator_member_id, collected_at, scene, status, submitter_member_id, confirmed_count, doubted_count, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertVerification = db.prepare(`
    INSERT INTO narrative_verifications (narrative_id, verifier_member_id, verdict, note)
    VALUES (?, ?, ?, ?)
  `);

  const insertInheritance = db.prepare(`
    INSERT INTO inheritances (heirloom_id, from_member_id, to_member_id, inherited_at, note)
    VALUES (?, ?, ?, ?, ?)
  `);

  const updateHolder = db.prepare(`
    UPDATE heirlooms SET current_holder_id = ? WHERE id = ?
  `);

  const familyId = insertFamily.run(
    "陈氏家族",
    "浙江绍兴",
    "原籍浙江绍兴，二十世纪中叶因战乱迁居江南，三代人守护着祖辈留下的传家之物",
  ).lastInsertRowid;

  const gen1Id1 = insertMember.run(
    familyId,
    "陈敬之",
    "男",
    1,
    null,
    1925,
    2010,
    "家族第一代，少年离家赴沪谋生",
  ).lastInsertRowid;
  const gen1Id2 = insertMember.run(
    familyId,
    "周玉梅",
    "女",
    1,
    null,
    1928,
    2015,
    "陈敬之妻，大家闺秀出身",
  ).lastInsertRowid;

  const gen2Id1 = insertMember.run(
    familyId,
    "陈建国",
    "男",
    2,
    gen1Id1,
    1950,
    null,
    "长子，退休教师",
  ).lastInsertRowid;
  const gen2Id2 = insertMember.run(
    familyId,
    "陈建华",
    "男",
    2,
    gen1Id1,
    1955,
    null,
    "次子，工程师",
  ).lastInsertRowid;
  const gen2Id3 = insertMember.run(
    familyId,
    "陈秀兰",
    "女",
    2,
    gen1Id1,
    1958,
    null,
    "三女，医生",
  ).lastInsertRowid;

  const gen3Id1 = insertMember.run(
    familyId,
    "陈子轩",
    "男",
    3,
    gen2Id1,
    1982,
    null,
    "长孙，软件工程师",
  ).lastInsertRowid;
  const gen3Id2 = insertMember.run(
    familyId,
    "陈子墨",
    "男",
    3,
    gen2Id2,
    1988,
    null,
    "次孙，建筑师",
  ).lastInsertRowid;
  const gen3Id3 = insertMember.run(
    familyId,
    "陈雨桐",
    "女",
    3,
    gen2Id3,
    1992,
    null,
    "孙女，青年画家",
  ).lastInsertRowid;

  const heirloom1Id = insertHeirloom.run(
    familyId,
    "青花缠枝莲纹瓷碗",
    "清代光绪年间",
    "家族始祖陈老太爷在绍兴老家所用，1948年陈敬之离家时从母亲手中接过，随身携带五十余载",
    "碗口直径约12厘米，釉色青中带白，缠枝莲纹清晰，碗底有小磕，碗内沿有经年使用的磨痕",
    gen3Id1,
  ).lastInsertRowid;

  const heirloom2Id = insertHeirloom.run(
    familyId,
    "铜鎏金长命锁",
    "民国二十年",
    "周玉梅的母亲在她出生时打制，陪嫁带到陈家，传女不传男",
    '长约8厘米，宽约5厘米，铜质鎏金，正面錾刻"长命富贵"四字，背面刻有"周"字家徽，锁身稍有氧化',
    gen3Id3,
  ).lastInsertRowid;

  const heirloom3Id = insertHeirloom.run(
    familyId,
    "线装本《增广贤文》",
    "民国十五年",
    "陈敬之的父亲陈茂才所用，书页上留有多处朱笔批注，是家族重视教育的见证",
    '蓝布函套，白棉纸印刷，共四册，书角略有磨损，扉页有"茂才藏书"朱红印章一方',
    gen2Id2,
  ).lastInsertRowid;

  const heirloom4Id = insertHeirloom.run(
    familyId,
    "老式银壳怀表",
    "1947年",
    "陈敬之1947年在上海当学徒满师时，师父所赠，作为出师纪念",
    '银质表壳直径约4.5厘米，表盘为瓷面，罗马数字刻度，表盖内侧刻有"艺成赠"三字及师父落款，表已停走',
    gen3Id2,
  ).lastInsertRowid;

  const n1Id = insertNarrative.run(
    heirloom1Id,
    "那只锁在柜子里的碗",
    '爷爷说，这只碗是他离家那天母亲塞给他的。那天清晨天还没亮，母亲把家里仅有的几个银元包好塞在他怀里，又从碗橱最里面拿出这只碗，说："带上它，想家的时候就看看。" 这一走就是五十年，直到1998年爷爷才第一次回老家，碗一直锁在他那只旧皮箱里，谁也不让碰。',
    "陈建国",
    "持有人的父亲",
    gen2Id1,
    "2018-04-05",
    "清明家祭",
    "verified",
    gen2Id1,
    2,
    0,
    "2018-04-06",
  ).lastInsertRowid;

  insertVerification.run(
    n1Id,
    gen2Id2,
    "confirmed",
    "我也记得这事，父亲后来常提起。",
  );
  insertVerification.run(
    n1Id,
    gen2Id3,
    "confirmed",
    "对，奶奶生前也跟我说过。",
  );

  const n2Id = insertNarrative.run(
    heirloom1Id,
    "碗底的小磕",
    "我记得小时候偷拿这只碗出来玩，不小心磕在灶台角上，碗底缺了一小块。爷爷当时气得手都抖了，但最后只是轻轻把碗收起来，一句重话也没说我。后来他跟我说，碗有了磕，才更像家里的碗。",
    "陈建华",
    "持有人的二叔",
    gen2Id2,
    "2019-09-20",
    "家族聚会",
    "verified",
    gen2Id2,
    2,
    0,
    "2019-09-21",
  ).lastInsertRowid;

  insertVerification.run(
    n2Id,
    gen2Id1,
    "confirmed",
    "是有这事，当年我还在场。",
  );
  insertVerification.run(
    n2Id,
    gen2Id3,
    "confirmed",
    "二哥说得对，我也有印象。",
  );

  const n3Id = insertNarrative.run(
    heirloom2Id,
    "奶奶的嫁妆",
    "奶奶说她出嫁时只有两个樟木箱，这只长命锁是她母亲偷偷塞给她的，说这是外婆家传下来的，要一代一代传下去。她戴了一辈子，到老了脖子上还留着银锁压出的印子。",
    "陈秀兰",
    "持有人的母亲",
    gen2Id3,
    "2020-03-08",
    "妇女节家庭茶话会",
    "verified",
    gen2Id3,
    2,
    0,
    "2020-03-09",
  ).lastInsertRowid;

  insertVerification.run(
    n3Id,
    gen2Id1,
    "confirmed",
    "母亲在世时确实常提此事。",
  );
  insertVerification.run(n3Id, gen2Id2, "confirmed", "我也听母亲讲过。");

  const n4Id = insertNarrative.run(
    heirloom3Id,
    "朱笔批注",
    '爷爷小时候不喜欢读书，太爷就拿着这书一句一句教他，每页的批注都是太爷用朱笔写的。后来爷爷自己成了读书人，才明白父亲当年的用心。他常说："书要读，字要写，人才立得住。"',
    "陈敬之（生前口述）",
    "持有人的祖父",
    null,
    "2008-10-15",
    "病榻前口述，由陈建国记录",
    "verified",
    gen2Id1,
    2,
    0,
    "2008-10-16",
  ).lastInsertRowid;

  insertVerification.run(
    n4Id,
    gen2Id1,
    "confirmed",
    "父亲临终前亲口所言，我亲笔记下。",
  );
  insertVerification.run(
    n4Id,
    gen2Id3,
    "confirmed",
    "我也在场，父亲确实这样说过。",
  );

  const n5Id = insertNarrative.run(
    heirloom3Id,
    "修复经历",
    "2015年这本书的书脊脱胶了，我找了古籍修复师，用传统的浆糊和棉线重新装订。修复师说这书保存得很好，只是书脊自然老化。修复后我按太爷的原样重新函好，放在樟木箱里。",
    "陈建华",
    "持有人本人",
    gen2Id2,
    "2015-11-02",
    "古籍修复完成记录",
    "verified",
    gen2Id2,
    1,
    0,
    "2015-11-03",
  ).lastInsertRowid;

  insertVerification.run(
    n5Id,
    gen2Id1,
    "confirmed",
    "修复后我也看过，确实完好如初。",
  );

  const n6Id = insertNarrative.run(
    heirloom4Id,
    "师父的礼物",
    '爷爷说他师父是个很严厉的人，三年学徒没少挨打挨骂。满师那天，师父把他叫到跟前，把这只怀表递给他，说："守时，守信，这是做人的根本。" 这只表爷爷戴了一辈子，直到表盘玻璃碎了才收起来。',
    "陈建国",
    "持有人的大伯",
    gen2Id1,
    "2017-06-18",
    "父亲节",
    "pending",
    gen2Id1,
    0,
    1,
    null,
  ).lastInsertRowid;

  insertVerification.run(
    n6Id,
    gen3Id2,
    "doubted",
    "我听爷爷提过怀表，但没说是师父送的，需要再核实。",
  );

  insertInheritance.run(
    heirloom1Id,
    null,
    gen1Id1,
    "1948-02-18",
    "陈敬之离乡时，母亲赠予",
  );
  insertInheritance.run(
    heirloom1Id,
    gen1Id1,
    gen2Id1,
    "2005-10-01",
    "陈敬之八十大寿时传给长子",
  );
  insertInheritance.run(
    heirloom1Id,
    gen2Id1,
    gen3Id1,
    "2022-01-31",
    "除夕家宴上，陈建国传于长孙",
  );
  updateHolder.run(gen3Id1, heirloom1Id);

  insertInheritance.run(
    heirloom2Id,
    null,
    gen1Id2,
    "1928-06-15",
    "周玉梅出生时，母亲打制赠予",
  );
  insertInheritance.run(
    heirloom2Id,
    gen1Id2,
    gen2Id3,
    "1980-05-01",
    "周玉梅传于女儿陈秀兰",
  );
  insertInheritance.run(
    heirloom2Id,
    gen2Id3,
    gen3Id3,
    "2021-09-10",
    "陈秀兰传于女儿陈雨桐",
  );
  updateHolder.run(gen3Id3, heirloom2Id);

  insertInheritance.run(
    heirloom3Id,
    null,
    gen1Id1,
    "1945-09-01",
    "陈茂才传于儿子陈敬之",
  );
  insertInheritance.run(
    heirloom3Id,
    gen1Id1,
    gen2Id2,
    "1999-09-01",
    "陈敬之传于喜爱读书的次子陈建华",
  );
  updateHolder.run(gen2Id2, heirloom3Id);

  insertInheritance.run(
    heirloom4Id,
    null,
    gen1Id1,
    "1947-12-20",
    "陈敬之满师时师父所赠",
  );
  insertInheritance.run(
    heirloom4Id,
    gen1Id1,
    gen3Id2,
    "2009-05-04",
    "陈敬之临终前指定传于喜爱机械的孙子陈子墨",
  );
  updateHolder.run(gen3Id2, heirloom4Id);

  console.log("种子数据填充完成：");
  console.log(`  家族: 1 个 (陈氏家族)`);
  console.log(`  成员: 8 人 (三代)`);
  console.log(`  传家物: 4 件`);
  console.log(`  记忆叙事: 6 条 (其中已采信 5 条、待核实 1 条)`);
  console.log(`  传承记录: 11 次`);
  console.log(`  验证记录: 11 条 (印证 10 次、存疑 1 次)`);
}

seed();

module.exports = seed;
