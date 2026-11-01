require('dotenv').config();
const express = require('express');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const path = require('path');
const { PassThrough, Readable } = require('stream');
const crypto = require('crypto');
const mongoose = require('mongoose');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

process.on('uncaughtException', (err) => {
  try { console.error('Critique - Exception non interceptée :', err); } catch (e) {}
});

process.on('unhandledRejection', (reason) => {
  try { console.error('Critique - Rejet de promesse non géré :', reason); } catch (e) {}
});

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_SIZE = process.env.MAX_UPLOAD_SIZE || '10gb';
const BASE_URL = process.env.BASE_URL || 'https://poste.adamdh7.org';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const BOT_CF_ACCOUNT_ID = process.env.BOT_CLOUDFLARE_ACCOUNT_ID;
const BOT_CF_API_TOKEN = process.env.BOT_CLOUDFLARE_API_TOKEN;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const ICON_URL = BASE_URL + '/poste2.png';
const MEDIA_DIR = process.cwd();

const FFMPEG_AVAILABLE = (() => {
    try {
        const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        return !result.error && result.status === 0;
    } catch (e) {
        return false;
    }
})();

try {
  const publicPath = path.join(process.cwd(), 'public');
  if (!fs.existsSync(publicPath)) {
    fs.mkdirSync(publicPath);
  }
} catch (err) {}

let usersLang = {};
let userBots = {};
let votes = {};
let lastFormats = {};
let userCredits = {};
let allKnownChats = [];

const mongoUris = [process.env.MONGO_URI].filter(uri => typeof uri === 'string' && uri.trim() !== '');

const contentSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  requestFingerprint: { type: String, unique: true, sparse: true },
  content: { type: Object, required: true }
});

const userSchema = new mongoose.Schema({
  tfid: { type: String, required: true, unique: true },
  pwen: { type: Number, default: 0 },
  lastPwenAdd: { type: Number, default: 0 },
  resan: { type: Array, default: [] }
});

const botStateSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  usersLang: { type: Object, default: {} },
  userBots: { type: Object, default: {} },
  votes: { type: Object, default: {} },
  lastFormats: { type: Object, default: {} },
  userCredits: { type: Object, default: {} },
  allKnownChats: { type: Array, default: [] }
});

const connections = mongoUris.map(uri => mongoose.createConnection(uri, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 10000
}));

const models = connections.map(conn => conn.model('Content', contentSchema));
const userModels = connections.map(conn => conn.model('User', userSchema));
const botStateModels = connections.map(conn => conn.model('BotState', botStateSchema));

async function loadBotStateFromMongo() {
  try {
    for (const m of botStateModels) {
      const state = await m.findOne({ id: 'global_state' }).lean();
      if (state) {
        usersLang = state.usersLang || {};
        userBots = state.userBots || {};
        votes = state.votes || {};
        lastFormats = state.lastFormats || {};
        userCredits = state.userCredits || {};
        allKnownChats = state.allKnownChats || [];
        return;
      }
    }
  } catch (e) {}
}

const saveData = async () => {
  try {
    const payload = {
      id: 'global_state',
      usersLang: usersLang,
      userBots: userBots,
      votes: votes,
      lastFormats: lastFormats,
      userCredits: userCredits,
      allKnownChats: allKnownChats
    };
    for (const m of botStateModels) {
      await m.updateOne({ id: 'global_state' }, payload, { upsert: true });
    }
  } catch (e) {}
};

const sizeMultipliers = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
const memoryUserCache = new Map();

function parseMaxSize(str) {
  try {
    const raw = String(str || '10gb').trim();
    const match = raw.match(/^(\d+(?:\.\d+)?)([kmgt]?b?)$/i);
    if (!match) return 10 * 1024 ** 3;
    const num = parseFloat(match[1]);
    const unit = String(match[2] || 'b').toLowerCase();
    return Math.floor(num * (sizeMultipliers[unit] || sizeMultipliers.gb));
  } catch (e) {
    return 10 * 1024 ** 3;
  }
}
const maxSizeBytes = parseMaxSize(MAX_UPLOAD_SIZE);

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const sessions = {};
const activeMenus = {};
const defaultImage = "https://adamdh7.org/asset/poste.png";
let BOT_USERNAME = "AdamDH7Bot";

const t = {
  ht: { 
    info_text: [
      "Byenveni sou platfòm ofisyèl Asistan an! Sistèm pwofesyonèl sa a devlope espesyalman pou fasilite fason ou jere ak pibliye kontni sou plizyè chanèl Telegram an menm tan, avèk yon nivo efikasite san parèy. Ou kapab sèvi ak kòmand sa yo pou eksplwate tout potansyèl zouti sa a:\n/lang - Chwazi lang ki pi byen koresponn ak ou a.\n/add - Enskri yon nouvo chanèl nan sistèm nan.\n/del - Retire yon chanèl ou pa swete itilize ankò.\n/list - Tcheke tout chanèl ki sou kont ou.\n/publish - Kòmanse pwosedi pou difize yon mesaj.\n/pair - Jenere yon kòd idantifikasyon inik ak sekirize.\n/adm - Dekouvri pwogram referans nou an ak tout avantaj li yo.",
      "Asistan an kontan akeyi w! Zouti entèlijan sa a kreye pou pèmèt ou otomatize ak òganize piblikasyon w yo sou Telegram nan yon fason konplètman santralize epi pwofesyonèl. Men kòmand prensipal ki disponib pou ede w avanse rapidman:\n/lang - Modifye langaj kominikasyon bot la.\n/add - Konekte yon chanèl anplis sou pwofil ou.\n/del - Siprime chanèl ou pa bezwen yo.\n/list - Afiche lis konplè chanèl aktif ou yo.\n/publish - Kreye epi pibliye kontni fasilman.\n/pair - Obteni yon kòd konfidansyèl.\n/adm - Jwenn lyen afilyasyon w lan pou envite moun."
    ],
    add_prompt: [
      "Sistèm nan pare pou resevwa chanèl ou a. Pou nou kapab verifye epi konekte chanèl ou a an sekirite, tanpri ekri non itilizatè chanèl la (ki dwe kòmanse avèk senbòl @ la) oubyen ou ka tou senpleman kole lyen envitasyon dirèk la nan bwat mesaj sa a.",
      "Inisyalizasyon an ajoute chanèl la kòmanse kounye a. Li nesesè pou w founi nou lyen ofisyèl chanèl la oubyen idantifyan inik li a (ki gen @ ladan l) pou Asistan an kapab valide dwa w kòm administratè epi entegre li dirèkteman sou pwofil ou."
    ],
    add_success: [
      "Operasyon an fini avèk siksè total! Chanèl ou a kounye a ofisyèlman anrejistre nan baz done sekirize nou an. Ou kapab kòmanse planifye ak pibliye kontni miltimedya w yo sou chanèl sa a nenpòt kilè ou vle san okenn entèripsyon.",
      "Asistan an konfime ke chanèl ou a byen verifye epi ajoute nèt. Tout paramèt yo an plas pou w ka jwi yon eksperyans difizyon san pwoblèm ak tout zouti piblikasyon avanse nou ofri yo. Ou pare pou avanse ak premye post ou a."
    ],
    add_exists: [
      "Nou fè w konnen chanèl sa a deja egziste sou pwofil ou aktyèlman. Sistèm nou an detekte l nan baz done a, ki vle di ou pa gen okenn bezwen anrejistre l ankò. Ou ka dirèkteman ale sou kòmand piblikasyon an pou kòmanse difize kontni.",
      "Verifikasyon Asistan an montre ke gwoup oubyen chanèl sa a te deja ajoute anvan. Li deja konfigire pou aksepte piblikasyon w yo. Si w bezwen jere li, ou ka toujou itilize lis ou a pou wè detay ki asosye ak li."
    ],
    pub_done: [
      "Felisitasyon pou ou! Tout pwosesis piblikasyon an dewoule san okenn echèk, epi kontni w lan distribye avèk presizyon sou chanèl ou te chwazi a. Moun yo kounye a kapab kòmanse reyaji ak entèraji avèk post ou a imedyatman.",
      "Misyon ou an akonpli nèt! Asistan an pran chaj demann ou an epi li reyisi depoze mesaj ou a egzakteman jan w te planifye l la. Piblikasyon an fèt sou fòma pwofesyonèl ou te defini a san okenn defo detekte."
    ],
    session_expired: [
      "Peryòd validite ki te asiyen pou sesyon travay sa a fini aktyèlman. Pou rezon sekirite ak estabilite, sistèm nan otomatikman fèmen sesyon yo lè yo pran twòp tan san aktivite. Tanpri, itilize kòmandman inisyal la ankò pou w kapab rekòmanse operasyon ou an kounye a.",
      "Tan ou te genyen pou finalize operasyon sa a fin ekoule. Asistan an dwe sispann pwosedi aktyèl la pou asire sekirite done yo. Nou envite w re-voye kòmand piblikasyon an oswa paramèt la ankò yon fason pou nou kreye yon nouvo sesyon ki fre pou ou."
    ],
    must_subscribe: [
      "Pou w gen otorizasyon itilize tout resous ak fonksyonalite bot pwofesyonèl sa a, politik itilizasyon an egzije pou w abòne avèk chanèl ofisyèl nou an anvan. Etap sa a endispansab pou nou kapab ofri w yon sipò teknik rapid ak tout mizajou enpòtan sistèm nan.",
      "Asistan an pa kapab trete demann ou an kounye a paske w poko manm chanèl kominote ofisyèl nou an. Tanpri, klike sou bouton ki anba a pou w kapab rejwenn nou. Yon fwa w fin abòne, w ap jwenn aksè total e san limit ak tout opsyon kreyasyon ak piblikasyon nou yo."
    ],
    promo_msg: [
      "Nouvo dekouvèt! Asistan an envite w vin pwofite tout potansyèl eksklizif sistèm nan ofri. Nou sot ajoute opsyon ki pi modèn ak pèfòman ki fèt espesyalman pou rann piblikasyon ak jesyon chanèl ou yo pi dinamik, pi rapid, epi pi enpòtan toujou. Klike kounye a pou pa rate okenn detay sou nouvo fonksyonalite yo!",
      "Èske w te konnen ou ka fasilite vi w pi plis toujou ak Asistan an? Sistèm nan ap kontinye evolye pou ba ou pi bon kalite eksperyans nan jere plizyè kontni an menm tan. Pa rete dèyè, pwofite dekri tout zouti pwodiktivite ak metòd pataj ki fenk disponib pou ou jodi a."
    ],
    pub_err: ["Bot la pa gen aksè admin ankò nan chanèl ou te chwazi a. Tanpri, asire w ou bal dwa pou pibliye."],
    del_prompt: ["Chwazi ak atansyon chanèl ou vle efase a anba a:"],
    del_success: ["Demann sipresyon an reyisi nèt. Nou elimine chanèl sa a nan lis ou a."],
    list_empty: ["Li parèt aklè ke lis chanèl ou an vid kounye a. Ajoute yon chanèl anvan."],
    list_interactive: ["Isit la ou ka klike sou youn nan chanèl ou yo pou jwenn detay konplè li:"],
    pub_bot: ["Tanpri, seleksyone chanèl kote w swete afiche pwochen piblikasyon w lan:"],
    pub_img: ["Kounye a, ou dwe voye imaj oubyen videyo ki pou akonpaye piblikasyon w lan."],
    pub_cap: ["Voye tèks prensipal la. Asistan an ap fòmate l epi asire l pwofesyonèl pou ou."],
    pub_don: ["Si w vle, ou kapab voye yon lyen pou sipò ou donasyon. Sinon, klike sou Okenn."],
    pub_clk: ["Ou ka entegre yon lyen final pou redireksyon itilizatè yo. Sinon, chwazi Okenn."],
    pub_emo: ["Fè chwa yon emojy ki byen repwezante santiman oubyen tèm post ou a:"],
    buttons_choice_prompt: ["Asistan an pare pou l swa ajoute lòt bouton anba mesaj la oubyen difize l imedyatman."],
    btn_add_more: ["Ajoute lòt bouton"],
    btn_pub_now: ["Difizyon imedya"],
    btn_name_prompt: ["Ekri egzakteman tèks ou vle ki afiche anndan bouton an (egz: Vizite sit nou an)"],
    btn_url_prompt: ["Voye lyen ki dwe mache ansanm ak bouton sa a (dwe yon url valid ki kòmanse ak https)"],
    btn_none: ["Okenn aksyon"], 
    btn_def_img: ["Imaj rekòmande bot la"], 
    btn_no_img: ["San miltimedya"], 
    bot_added: ["Asistan an konfime otorizasyon l nan: {channel}. Ou kapab pibliye kounye a san pè."], 
    already_voted: ["Nou deja anrejistre vòt ou a pou piblikasyon sa a deja."], 
    lang_welcome: ["Pou asire yon bon kominikasyon, tanpri seleksyone lang ou pi byen konprann nan:"], 
    processing_msg: ["Asistan an ap evalye epi trete demann ou an. Yon ti pasyans tanpri..."],
    pub_last_format_btn: ["Mwen vle itilize dènye modèl la ankò"],
    pub_media_prompt: ["Etap miltimedya a kòmanse. Voye dosye w yo pou nou analize yo."],
    media_mode_prompt: ["Ki fòma afichaj ou prefere pou plizyè medya yo?"],
    btn_multiples: ["Mòd albòm konplè"],
    btn_onebyone: ["Yon mesaj pou chak"],
    btn_my_text: ["Konsève tèks orijinal mwen"],
    send_cap_exact: ["Soumèt tèks ou a menm jan ou ta renmen wè li pibliye a."],
    choose_last_cap_prompt: ["Ou pito kontinye ak ansyen tèks ou a oswa w ap soumèt yon lòt?"],
    btn_last_caption: ["Konsève ansyen an"],
    btn_new_caption: ["Voye yon lòt mesaj"],
    btn_subscribe: ["Abòne kounye a"],
    err_user_not_admin: ["Sistèm nou an detekte w pa gen privilèj administratif kounye a nan chanèl la."],
    err_bot_not_admin: ["Asistan an pa kapab travay si l pa gen dwa admin nan chanèl w ap mete a."],
    err_both_not_admin: ["De kondisyon yo pa ranpli: ni ou ni Asistan an pa administratè la."],
    pair_prompt: ["Li lè pou w rantre nimewo telefòn ou ansanm avèk kòd zòn peyi w la."],
    pair_err: ["Sistèm nan endike yon echèk teknik pandan jenere kòd pèsonèl ou a."],
    adm_text: ["Men adrès lyen referal ofisyèl ou ki pèmèt ou jwenn rekonpans yo:"],
    ref_success: ["Asistan an gen bon nouvèl! Yon nouvo moun enskri atravè lyen referal ou a."],
    btn_pub_here: ["Difize isit la imedyatman"],
    sync_msg: ["Nou ap pwosede a yon senkronizasyon estati w sou tout chanèl yo. Pasyante..."],
    promo_btn: ["Dekouvri nouvo potansyèl", "Klike pou esplore"]
  },
  fr: { 
    info_text: [
      "Bienvenue sur la plateforme officielle de l'Asistan ! Ce système professionnel a été minutieusement conçu pour optimiser la gestion et la publication simultanée de vos contenus sur une multitude de canaux Telegram, le tout avec une efficacité inégalée. Voici les commandes qui vous permettront d'exploiter tout le potentiel de cet outil :\n/lang - Sélectionnez la langue de votre choix.\n/add - Enregistrez un nouveau canal à votre tableau de bord.\n/del - Supprimez un canal devenu obsolète.\n/list - Consultez l'intégralité de vos canaux actifs.\n/publish - Initiez une nouvelle diffusion de contenu.\n/pair - Générez votre code d'authentification sécurisé.\n/adm - Découvrez notre programme de parrainage et ses nombreux avantages.",
      "L'Asistan est ravi de vous accueillir ! Cet outil intelligent a été créé pour vous permettre d'automatiser et de structurer vos publications Telegram de manière centralisée et professionnelle. Prenez le contrôle en utilisant les commandes principales suivantes :\n/lang - Modifiez la langue de communication du bot.\n/add - Connectez un canal supplémentaire à votre profil.\n/del - Éliminez les canaux que vous ne gérez plus.\n/list - Affichez la liste exhaustive de vos canaux opérationnels.\n/publish - Créez et distribuez votre contenu aisément.\n/pair - Obtenez votre code confidentiel d'accès.\n/adm - Récupérez votre lien d'affiliation exclusif."
    ],
    add_prompt: [
      "Le système est prêt à lier votre canal. Afin que nous puissions procéder à une vérification rigoureuse et sécurisée, veuillez fournir le nom d'utilisateur officiel de votre canal (qui doit impérativement débuter par @) ou soumettez simplement son lien d'invitation direct dans ce chat.",
      "Le processus d'intégration de votre canal est initié. Il est requis de nous transmettre le lien officiel ou l'identifiant exact de votre canal (contenant le @) pour que l'Asistan puisse valider vos privilèges d'administrateur et associer ce canal à votre interface de gestion personnelle."
    ],
    add_success: [
      "L'opération a été couronnée de succès ! Votre canal est désormais officiellement enregistré et synchronisé dans notre base de données sécurisée. Vous avez à présent la pleine capacité de programmer et de diffuser vos médias et messages sur ce canal à n'importe quel moment, sans aucune restriction.",
      "L'Asistan vous confirme que la vérification et l'intégration de votre canal sont achevées. L'ensemble des paramètres nécessaires est en place pour vous assurer une expérience de publication fluide et optimale. Vous êtes prêt à amorcer votre première campagne de diffusion."
    ],
    add_exists: [
      "Nous vous informons que ce canal figure déjà parmi ceux associés à votre profil. Notre système l'a détecté dans sa base de données active, rendant tout nouvel enregistrement inutile. Vous pouvez vous rendre directement sur la commande de publication pour commencer à diffuser vos contenus sur ce canal.",
      "L'analyse de l'Asistan révèle que ce groupe ou canal a préalablement été intégré à votre liste. Sa configuration est déjà finalisée pour accueillir vos diffusions. Si vous souhaitez vérifier son statut, nous vous invitons à consulter la liste détaillée de vos canaux connectés."
    ],
    pub_done: [
      "Toutes nos félicitations ! L'intégralité du processus de publication s'est déroulée de manière fluide et sans la moindre erreur. Votre contenu a été distribué avec exactitude sur le canal sélectionné, et votre audience peut d'ores et déjà commencer à interagir avec votre message.",
      "Mission accomplie avec succès ! L'Asistan a pris en charge votre requête et a procédé au déploiement de votre message selon vos directives précises. La publication respecte le format professionnel que vous avez défini, et aucun dysfonctionnement n'a été recensé lors de la transmission."
    ],
    session_expired: [
      "Le délai de validité attribué à cette session de travail est actuellement expiré. Par mesure de sécurité et pour garantir l'intégrité de vos données, le système clôture automatiquement les sessions inactives de manière prolongée. Nous vous prions de réitérer votre commande initiale pour ouvrir une nouvelle session.",
      "Le temps alloué pour finaliser cette manipulation est écoulé. L'Asistan est contraint d'interrompre la procédure en cours pour prévenir toute faille de sécurité. Nous vous invitons à relancer votre commande de publication afin que nous puissions instaurer un nouveau cycle d'interaction opérationnel."
    ],
    must_subscribe: [
      "Afin d'obtenir l'autorisation d'exploiter toutes les ressources et fonctionnalités avancées de ce bot professionnel, notre politique d'utilisation exige une souscription préalable à notre canal officiel. Cette étape est indispensable pour vous garantir un support technique réactif et la réception des mises à jour critiques du système.",
      "L'Asistan n'est actuellement pas en mesure de traiter votre demande, car votre adhésion à notre communauté officielle n'a pas été confirmée. Veuillez cliquer sur le bouton de souscription ci-dessous pour nous rejoindre. Cette adhésion vous débloquera un accès illimité et sécurisé à l'ensemble de nos options de création."
    ],
    promo_msg: [
      "Découverte majeure ! L'Asistan vous invite à exploiter le potentiel exclusif que notre système vient de déployer. Nous avons intégré de nouvelles options modernes et performantes, conçues spécifiquement pour rendre la gestion et la publication sur vos canaux encore plus dynamiques et percutantes. Cliquez maintenant pour explorer ces nouveautés inédites !",
      "Saviez-vous qu'il est possible de simplifier davantage votre gestion avec l'Asistan ? Notre infrastructure évolue en permanence pour vous garantir une expérience utilisateur d'excellence lors de la gestion simultanée de vos contenus. Ne restez pas en marge, profitez des outils de productivité et des méthodes de diffusion récemment mis à votre disposition."
    ],
    pub_err: ["Le bot a malheureusement perdu ses droits administratifs sur ce canal. Veuillez restaurer ses privilèges."],
    del_prompt: ["Veuillez sélectionner avec attention le canal que vous souhaitez retirer de votre profil :"],
    del_success: ["La procédure de suppression a été menée à bien. Ce canal a été définitivement effacé de vos registres."],
    list_empty: ["Votre répertoire de canaux est actuellement vierge. Nous vous suggérons d'ajouter un canal pour débuter."],
    list_interactive: ["Cliquez sur l'un de vos canaux ci-dessous pour accéder à ses statistiques et détails complets :"],
    pub_bot: ["Sélectionnez le canal spécifique sur lequel vous désirez déployer cette nouvelle publication :"],
    pub_img: ["Veuillez désormais transmettre le fichier image ou vidéo qui viendra illustrer votre publication."],
    pub_cap: ["Transmettez le contenu textuel principal. L'Asistan se chargera de le formater professionnellement."],
    pub_don: ["Vous pouvez fournir un lien destiné au soutien financier (don). Dans le cas contraire, optez pour Aucun."],
    pub_clk: ["Veuillez insérer l'URL de redirection finale pour vos utilisateurs. Si vous n'en avez pas, sélectionnez Aucun."],
    pub_emo: ["Faites le choix d'un émoji pertinent qui saura traduire l'ambiance ou le thème de votre publication :"],
    buttons_choice_prompt: ["L'Asistan est prêt. Souhaitez-vous intégrer des boutons supplémentaires ou procéder à la diffusion immédiate ?"],
    btn_add_more: ["Insérer un bouton"],
    btn_pub_now: ["Diffuser immédiatement"],
    btn_name_prompt: ["Renseignez le texte exact qui devra figurer à l'intérieur de ce bouton (ex: Visitez notre site web)"],
    btn_url_prompt: ["Transmettez l'URL valide (débutant par https) qui sera associée à l'action de ce bouton"],
    btn_none: ["Aucune action"], 
    btn_def_img: ["Visuel recommandé"], 
    btn_no_img: ["Publier sans média"], 
    bot_added: ["L'Asistan confirme la validation de ses droits sur : {channel}. Vous êtes autorisé à publier."], 
    already_voted: ["Notre base de données indique que votre vote pour cette publication a déjà été pris en compte."], 
    lang_welcome: ["Dans un souci de communication optimale, veuillez choisir la langue que vous maîtrisez le mieux :"], 
    processing_msg: ["L'Asistan analyse et traite actuellement votre requête. Nous vous remercions pour votre patience..."],
    pub_last_format_btn: ["Appliquer le modèle précédent"],
    pub_media_prompt: ["La phase d'intégration multimédia est initiée. Envoyez vos fichiers pour analyse immédiate."],
    media_mode_prompt: ["Quel type de format d'affichage privilégiez-vous pour l'ensemble de ces médias ?"],
    btn_multiples: ["Format album complet"],
    btn_onebyone: ["Un message par média"],
    btn_my_text: ["Maintenir le texte original"],
    send_cap_exact: ["Soumettez votre texte de manière stricte, tel que vous désirez qu'il apparaisse lors de la diffusion."],
    choose_last_cap_prompt: ["Souhaitez-vous réutiliser votre texte antérieur ou préférez-vous formuler un nouveau message ?"],
    btn_last_caption: ["Conserver le précédent"],
    btn_new_caption: ["Rédiger un nouveau texte"],
    btn_subscribe: ["Souscrire dès maintenant"],
    err_user_not_admin: ["Le système indique formellement que vous ne possédez pas les privilèges administratifs requis ici."],
    err_bot_not_admin: ["L'Asistan est dans l'incapacité d'opérer tant qu'il ne dispose pas du statut d'administrateur."],
    err_both_not_admin: ["Les deux conditions sont insatisfaites : ni vous ni l'Asistan n'êtes administrateurs sur ce canal."],
    pair_prompt: ["Il est temps de renseigner votre numéro de téléphone, incluant impérativement l'indicatif de votre pays."],
    pair_err: ["Le système a signalé une défaillance technique inattendue lors de la génération de votre code."],
    adm_text: ["Voici votre lien de parrainage exclusif qui vous ouvrira l'accès à vos récompenses dédiées :"],
    ref_success: ["Excellente nouvelle de l'Asistan ! Un nouvel utilisateur a rejoint la plateforme via votre lien de parrainage."],
    btn_pub_here: ["Publier ici instantanément"],
    sync_msg: ["Nous procédons actuellement à la synchronisation de vos droits sur les différents canaux. Veuillez patienter..."],
    promo_btn: ["Explorer le potentiel", "Cliquez pour découvrir"]
  },
  es: { 
    info_text: [
      "¡Bienvenido a la plataforma oficial del Asistan! Este sistema profesional ha sido meticulosamente diseñado para optimizar la gestión y publicación simultánea de su contenido en múltiples canales de Telegram, todo con una eficiencia inigualable. A continuación, las comandos que le permitirán explotar todo el potencial de esta herramienta:\n/lang - Seleccione el idioma de su preferencia.\n/add - Registre un nuevo canal en su panel.\n/del - Elimine un canal que ya no utiliza.\n/list - Consulte la totalidad de sus canales activos.\n/publish - Inicie una nueva transmisión de contenido.\n/pair - Genere su código de autenticación seguro.\n/adm - Descubra nuestro programa de referidos y sus beneficios.",
      "¡El Asistan se complace en recibirle! Esta herramienta inteligente fue creada para permitirle automatizar y estructurar sus publicaciones de Telegram de forma centralizada y sumamente profesional. Tome el control utilizando las siguientes comandos:\n/lang - Modifique el idioma de comunicación del bot.\n/add - Conecte un canal adicional a su perfil personal.\n/del - Elimine los canales que ya no administra.\n/list - Visualice la lista exhaustiva de sus canales operativos.\n/publish - Cree y distribuya su contenido fácilmente.\n/pair - Obtenga su código de acceso confidencial.\n/adm - Recupere su enlace de afiliación exclusivo."
    ],
    add_prompt: [
      "El sistema se encuentra listo para vincular su canal. Para que podamos realizar una verificación rigurosa y totalmente segura, proporcione el nombre de usuario oficial de su canal (el cual debe comenzar con un @) o simplemente envíe su enlace de invitación directo en este chat.",
      "El proceso de integración de su canal ha comenzado. Es requisito indispensable que nos envíe el enlace oficial o el identificador exacto de su canal (incluyendo el @) para que el Asistan logre validar sus privilegios de administrador y asocie dicho canal a su interfaz."
    ],
    add_success: [
      "¡La operación ha sido un éxito total! Su canal ahora está oficialmente registrado y sincronizado en nuestra base de datos segura. Tiene la capacidad total de programar y transmitir sus medios y mensajes en este canal en cualquier momento, sin restricción alguna.",
      "El Asistan le confirma que la verificación e integración de su canal han finalizado exitosamente. Todos los parámetros necesarios están configurados para garantizarle una experiencia de publicación óptima. Usted se encuentra listo para iniciar su primera campaña de difusión."
    ],
    add_exists: [
      "Le informamos que este canal ya se encuentra entre los asociados a su perfil. Nuestro sistema lo ha detectado en su base de datos activa, por lo que no es necesario un nuevo registro. Puede acceder directamente al comando de publicación para empezar a difundir su contenido en él.",
      "El análisis exhaustivo del Asistan revela que este grupo o canal ha sido previamente integrado a su lista. Su configuración ya está finalizada para recibir sus difusiones. Si desea corroborar su estado, le invitamos a consultar la lista detallada de sus canales conectados."
    ],
    pub_done: [
      "¡Muchísimas felicidades! Todo el proceso de publicación se ha desarrollado de forma fluida y sin el menor error. Su contenido ha sido distribuido con máxima exactitud en el canal seleccionado, y su audiencia puede empezar a interactuar con su mensaje desde ahora mismo.",
      "¡Misión cumplida con rotundo éxito! El Asistan ha procesado su solicitud y desplegado su mensaje siguiendo sus directrices precisas. La publicación respeta el formato profesional que definió y no se ha reportado ninguna disfunción durante toda la transmisión."
    ],
    session_expired: [
      "El tiempo de validez asignado para esta sesión de trabajo ha caducado. Por medidas de máxima seguridad y para garantizar la integridad de sus datos, el sistema cierra de manera automática aquellas sesiones inactivas prolongadas. Le solicitamos amablemente reiterar su comando.",
      "El tiempo proporcionado para finalizar esta operación se ha agotado. El Asistan se ve en la necesidad de interrumpir el procedimiento en curso para prevenir cualquier vulnerabilidad. Le sugerimos relanzar su comando de publicación para abrir un ciclo de interacción completamente nuevo."
    ],
    must_subscribe: [
      "Para obtener el permiso de explotar todos los recursos y funcionalidades avanzadas de este bot profesional, nuestras normativas de uso exigen una suscripción previa a nuestro canal oficial. Este paso es imprescindible para asegurarle un soporte técnico rápido y actualizaciones críticas.",
      "Actualmente, el Asistan no puede procesar su solicitud, dado que su afiliación a nuestra comunidad oficial no está verificada. Por favor haga clic en el botón de suscripción a continuación para unirse. Esta acción le otorgará acceso ilimitado a todas nuestras opciones de creación."
    ],
    promo_msg: [
      "¡Un hallazgo increíble! El Asistan le invita a aprovechar el enorme potencial exclusivo que nuestro sistema ha implementado recientemente. Hemos integrado nuevas herramientas modernas diseñadas específicamente para dinamizar su gestión. ¡Haga clic ahora para explorar todas estas novedades inéditas!",
      "¿Sabía que simplificar aún más su flujo de trabajo es posible con el Asistan? Nuestra estructura evoluciona día a día para asegurarle la mejor experiencia al administrar sus contenidos en simultáneo. No se quede atrás, utilice ya las novedosas opciones de difusión que le ofrecemos hoy."
    ],
    pub_err: ["Lamentablemente el bot ha perdido sus permisos de administrador en este canal. Restaure los privilegios."],
    del_prompt: ["Seleccione de manera cuidadosa el canal que desea retirar permanentemente de su perfil:"],
    del_success: ["El procedimiento de eliminación concluyó satisfactoriamente. Este canal ha sido borrado de sus registros."],
    list_empty: ["Actualmente su directorio de canales se encuentra en blanco. Sugerimos agregar uno para comenzar."],
    list_interactive: ["Haga clic en cualquiera de sus canales a continuación para acceder a estadísticas y detalles completos:"],
    pub_bot: ["Seleccione el canal específico en el cual desea que se emita esta nueva publicación:"],
    pub_img: ["Es momento de transmitir el archivo de imagen o video que ilustrará y acompañará su publicación."],
    pub_cap: ["Envíe el contenido textual principal. El Asistan se encargará de formatearlo muy profesionalmente."],
    pub_don: ["Tiene la opción de proporcionar un enlace destinado a donaciones. En caso contrario, elija Ninguno."],
    pub_clk: ["Inserte el enlace final de redirección para sus usuarios. Si no cuenta con uno, seleccione Ninguno."],
    pub_emo: ["Elija un emoji altamente pertinente que logre capturar la esencia y el tema central de su publicación:"],
    buttons_choice_prompt: ["El Asistan está preparado. ¿Desea integrar botones adicionales o procedemos con la difusión inmediata?"],
    btn_add_more: ["Insertar un botón"],
    btn_pub_now: ["Difundir inmediatamente"],
    btn_name_prompt: ["Especifique el texto exacto que aparecerá al interior del botón (ej: Visita nuestra web)"],
    btn_url_prompt: ["Proporcione la URL válida (que inicie con https) que quedará asociada a la acción de este botón"],
    btn_none: ["Ninguna acción"], 
    btn_def_img: ["Imagen recomendada"], 
    btn_no_img: ["Publicar sin medios"], 
    bot_added: ["El Asistan ratifica la validez de sus permisos en: {channel}. Ya está totalmente autorizado a publicar."], 
    already_voted: ["Nuestra base de datos verifica que su voto para esta publicación ya ha sido contabilizado exitosamente."], 
    lang_welcome: ["Para asegurar una comunicación sin barreras, seleccione el idioma que domina con mayor destreza:"], 
    processing_msg: ["El Asistan se encuentra evaluando y procesando su solicitud actual. Agradecemos su amable espera..."],
    pub_last_format_btn: ["Aplicar el formato anterior"],
    pub_media_prompt: ["Inicia la fase de integración multimedia. Envíe sus archivos ahora mismo para ser analizados."],
    media_mode_prompt: ["¿Qué modalidad de visualización prefiere aplicar para el conjunto total de estos archivos multimedia?"],
    btn_multiples: ["Formato álbum completo"],
    btn_onebyone: ["Un mensaje individual"],
    btn_my_text: ["Mantener texto original"],
    send_cap_exact: ["Transmita su texto de manera estricta y literal, tal como anhela que se visualice en la difusión."],
    choose_last_cap_prompt: ["¿Le gustaría reutilizar su texto guardado o prefiere redactar un mensaje completamente nuevo?"],
    btn_last_caption: ["Conservar el previo"],
    btn_new_caption: ["Redactar texto nuevo"],
    btn_subscribe: ["Suscribirse de inmediato"],
    err_user_not_admin: ["El sistema señala formalmente que usted no ostenta los privilegios administrativos que se requieren aquí."],
    err_bot_not_admin: ["El Asistan está incapacitado para operar mientras carezca del estatus completo de administrador."],
    err_both_not_admin: ["No se cumple ninguna condición: ni usted ni el Asistan son administradores vigentes en este canal."],
    pair_prompt: ["Es el momento adecuado para introducir su número telefónico, incluyendo el respectivo código de país."],
    pair_err: ["Nuestro sistema ha reportado una inesperada falla técnica al momento de generar su código personal."],
    adm_text: ["Aquí dispone de su enlace de referidos exclusivo, el cual le otorgará el acceso a recompensas especiales:"],
    ref_success: ["¡Excelente novedad por parte del Asistan! Un nuevo usuario ha ingresado empleando su enlace de referido."],
    btn_pub_here: ["Publicar aquí al instante"],
    sync_msg: ["Procedemos con la sincronización de sus privilegios en los diversos canales. Por favor aguarde..."],
    promo_btn: ["Explorar el potencial", "Haga clic y descubra"]
  },
  en: { 
    info_text: [
      "Welcome to the official Asistan platform! This professional system has been meticulously engineered to optimize the management and simultaneous publication of your content across multiple Telegram channels, delivering unparalleled efficiency. Here are the commands that will allow you to unlock the full potential of this tool:\n/lang - Select your preferred language.\n/add - Register a new channel to your dashboard.\n/del - Remove a channel you no longer use.\n/list - View the entirety of your active channels.\n/publish - Initiate a new content broadcast.\n/pair - Generate your secure authentication code.\n/adm - Discover our referral program and its numerous benefits.",
      "The Asistan is delighted to welcome you! This intelligent tool was created to allow you to automate and structure your Telegram publications in a highly centralized and professional manner. Take full control by utilizing the following core commands:\n/lang - Modify the bot's communication language.\n/add - Connect an additional channel to your personal profile.\n/del - Eliminate channels you no longer manage.\n/list - Display the exhaustive list of your operational channels.\n/publish - Create and distribute your content effortlessly.\n/pair - Obtain your confidential access code.\n/adm - Retrieve your exclusive affiliate link."
    ],
    add_prompt: [
      "The system is completely prepared to link your channel. In order for us to perform a rigorous and highly secure verification, please provide the official username of your channel (which must begin with an @) or simply submit its direct invitation link in this chat.",
      "The integration process for your channel has been initiated. It is absolutely necessary to transmit the official link or exact identifier of your channel (including the @) so that the Asistan can validate your administrative privileges and associate the channel to your interface."
    ],
    add_success: [
      "The operation has been an outstanding success! Your channel is now officially registered and synchronized within our secure database. You now have the full capability to schedule and broadcast your media and messages on this channel at any given moment, without restrictions.",
      "The Asistan confirms that the verification and integration of your channel are thoroughly complete. All necessary parameters have been firmly established to guarantee an optimal and fluid publishing experience. You are now entirely ready to launch your first broadcast campaign."
    ],
    add_exists: [
      "We inform you that this channel already exists among those associated with your profile. Our system has detected it in its active database, rendering any new registration unnecessary. You may navigate directly to the publish command to begin broadcasting your content on it.",
      "A comprehensive analysis by the Asistan reveals that this group or channel has previously been integrated into your list. Its configuration is already finalized to accommodate your broadcasts. If you wish to verify its status, we invite you to consult the detailed list of connected channels."
    ],
    pub_done: [
      "Outstanding congratulations! The entirety of the publication process unfolded smoothly and without the slightest error. Your content has been distributed with pinpoint accuracy to the selected channel, and your audience can begin interacting with your message immediately.",
      "Mission accomplished with absolute success! The Asistan has taken charge of your request and deployed your message in strict accordance with your precise directives. The publication fully respects the professional format you defined, and no malfunction was detected during transmission."
    ],
    session_expired: [
      "The allocated validity period for this working session has currently expired. For maximum security and to guarantee data integrity, the system automatically terminates extended inactive sessions. We kindly request that you reiterate your initial command to initiate a brand-new session.",
      "The allotted time to finalize this operation has been entirely consumed. The Asistan is compelled to interrupt the ongoing procedure in order to prevent any potential security vulnerabilities. We encourage you to relaunch your publish command to establish a fresh, operational interaction cycle."
    ],
    must_subscribe: [
      "In order to gain the clearance required to exploit all resources and advanced functionalities of this professional bot, our usage policy dictates a prior subscription to our official channel. This step is indispensable for guaranteeing swift technical support and critical system updates.",
      "The Asistan is currently unable to process your request, as your membership in our official community has not yet been verified. Please click the subscription button provided below to join us. This action will unlock your unlimited and secure access to all of our creation options."
    ],
    promo_msg: [
      "A major breakthrough! The Asistan invites you to harness the massive, exclusive potential our system has recently deployed. We have integrated highly modern and performant options specifically designed to make managing and publishing on your channels far more dynamic. Click now to explore these features!",
      "Did you know it is possible to further streamline your workflow with the Asistan? Our infrastructure continuously evolves to ensure you receive a premium user experience when simultaneously managing your content. Do not remain on the sidelines; take advantage of the newly released productivity tools today."
    ],
    pub_err: ["The bot has unfortunately lost its administrative privileges in this channel. Please restore them."],
    del_prompt: ["Please carefully select the channel that you permanently wish to remove from your profile:"],
    del_success: ["The deletion procedure has been successfully concluded. This channel is entirely erased from your records."],
    list_empty: ["Your channel directory is currently empty. We highly recommend adding a new channel to get started."],
    list_interactive: ["Click on any of your channels listed below to access its complete statistics and comprehensive details:"],
    pub_bot: ["Select the specific channel on which you desire to deploy this brand new publication:"],
    pub_img: ["Please transmit the image or video file that will illustrate and accompany your publication now."],
    pub_cap: ["Provide the primary textual content. The Asistan will assume responsibility for formatting it professionally."],
    pub_don: ["You may provide a link intended for financial support or donations. Otherwise, simply opt for None."],
    pub_clk: ["Please insert the final redirection URL for your users. If you do not have one, select None."],
    pub_emo: ["Carefully choose an extremely relevant emoji that accurately captures the vibe and core theme of your post:"],
    buttons_choice_prompt: ["The Asistan is ready. Do you wish to integrate extra interactive buttons or proceed to immediate broadcast?"],
    btn_add_more: ["Insert a new button"],
    btn_pub_now: ["Broadcast instantly"],
    btn_name_prompt: ["Please state the exact text that must appear on the inside of this button (e.g., Visit our website)"],
    btn_url_prompt: ["Transmit the valid URL (which must begin with https) that will be associated with this button's action"],
    btn_none: ["No required action"], 
    btn_def_img: ["Recommended visual"], 
    btn_no_img: ["Publish without media"], 
    bot_added: ["The Asistan confirms the validation of its privileges on: {channel}. You are fully authorized to publish."], 
    already_voted: ["Our primary database indicates that your vote for this particular publication has already been recorded."], 
    lang_welcome: ["To ensure highly optimal communication, please choose the language you have mastered the most:"], 
    processing_msg: ["The Asistan is actively analyzing and processing your current request. We truly appreciate your patience..."],
    pub_last_format_btn: ["Apply the previous template"],
    pub_media_prompt: ["The multimedia integration phase is initiated. Send your files for immediate and thorough analysis."],
    media_mode_prompt: ["Which display format do you heavily prefer to apply for the entirety of these multimedia files?"],
    btn_multiples: ["Complete album format"],
    btn_onebyone: ["One message per item"],
    btn_my_text: ["Maintain original text"],
    send_cap_exact: ["Submit your text strictly and literally, exactly as you deeply desire it to appear during the broadcast."],
    choose_last_cap_prompt: ["Would you like to reuse your previously saved text or do you prefer to formulate a brand new message?"],
    btn_last_caption: ["Retain previous text"],
    btn_new_caption: ["Draft new message"],
    btn_subscribe: ["Subscribe right away"],
    err_user_not_admin: ["The system formally indicates that you do not possess the necessary administrative privileges here."],
    err_bot_not_admin: ["The Asistan is fundamentally incapacitated from operating as long as it lacks full administrator status."],
    err_both_not_admin: ["Both mandatory conditions remain unfulfilled: neither you nor the Asistan are administrators on this channel."],
    pair_prompt: ["It is the proper time to input your complete phone number, imperatively including your country code."],
    pair_err: ["The system has officially reported an unexpected technical failure while attempting to generate your code."],
    adm_text: ["Here is your exclusive referral link which will successfully grant you access to your dedicated rewards:"],
    ref_success: ["Excellent news from the Asistan! A brand new user has just joined the platform utilizing your referral link."],
    btn_pub_here: ["Publish here instantly"],
    sync_msg: ["We are currently processing the synchronization of your rights across the various channels. Please wait..."],
    promo_btn: ["Explore the potential", "Click to discover"]
  }
};

const assignLang = (fromId, lc) => {
  if (!fromId) return "ht";
  if (!lc) {
    usersLang[fromId] = "ht";
    return "ht";
  }
  const short = lc.substring(0, 2).toLowerCase();
  const valid = ["fr", "en", "es"].includes(short) ? short : "ht";
  usersLang[fromId] = valid;
  return valid;
};

const pickT = (chatId, key) => {
  const lang = usersLang[chatId] || "ht";
  const variants = (t[lang] && t[lang][key]) ? t[lang][key] : (t["ht"][key] || [""]);
  if (Array.isArray(variants)) {
    return variants[Math.floor(Math.random() * variants.length)];
  }
  return variants;
};

const formatTarget = (input) => {
  try {
    let cleaned = input.trim().replace(/^(https?:\/\/)?(www\.)?t\.me\//, "");
    cleaned = cleaned.replace(/^@/, "");
    return (!cleaned.startsWith("-")) ? "@" + cleaned : cleaned;
  } catch (err) {
    return input;
  }
};

const formatUrl = (input) => {
  try {
    let u = input.trim().replace(/\s+/g, '');
    u = u.replace(/(t\.me\/|telegram\.me\/)@/ig, "$1");
    if (u.startsWith("@")) return "https://t.me/" + u.substring(1);
    if (u.startsWith("tg://")) return u;
    if (!u.startsWith("http://") && !u.startsWith("https://")) {
      if (!u.includes(".")) return "https://t.me/" + u;
      return "https://" + u;
    }
    return u;
  } catch (err) {
    return input;
  }
};

async function sendTg(method, body) {
  let attempts = 0;
  const maxAttempts = 5;
  while (attempts < maxAttempts) {
    try {
      const res = await fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/" + method, {
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.ok) {
        if (method === "sendMessage" && body.reply_markup && body.reply_markup.inline_keyboard && body.reply_markup.inline_keyboard.length > 0) {
          const cId = parseInt(body.chat_id);
          if (!isNaN(cId) && cId > 0) activeMenus[cId] = data.result.message_id;
        }
        return data;
      }
      if (data.error_code === 429 && data.parameters && data.parameters.retry_after) {
        const waitTime = (data.parameters.retry_after * 1000) + 500;
        await new Promise(r => setTimeout(r, waitTime));
        attempts++;
        continue;
      }
      return data;
    } catch (err) {
      attempts++;
      if (attempts >= maxAttempts) return { ok: false, description: "Fetch Error: " + err.message };
      await new Promise(r => setTimeout(r, 1000 * attempts));
    }
  }
  return { ok: false, description: "Max attempts reached" };
}

async function checkAdminRights(channelId, userId) {
  try {
    const res = await sendTg("getChatMember", { chat_id: channelId, user_id: userId });
    if (res.ok && res.result) {
      return res.result.status === "administrator" || res.result.status === "creator";
    }
    return false;
  } catch (err) {
    return false;
  }
}

async function syncUserBots(chatId) {
  try {
    const botId = parseInt(TELEGRAM_TOKEN.split(":")[0]);
    let updated = false;
    for (const chatIdToCheck of allKnownChats) {
      const botIsAdmin = await checkAdminRights(chatIdToCheck, botId);
      if (botIsAdmin) {
        const userIsAdmin = await checkAdminRights(chatIdToCheck, chatId);
        if (userIsAdmin) {
          if (!userBots[chatId]) userBots[chatId] = [];
          if (!userBots[chatId].includes(chatIdToCheck)) {
            userBots[chatId].push(chatIdToCheck);
            updated = true;
          }
        }
      }
    }
    if (updated) await saveData();
  } catch (err) {}
  return userBots[chatId] || [];
}

async function askStep(chat_id, step) {
  try {
    if (!sessions[chat_id]) return;
    sessions[chat_id].step = step;
    switch(step) {
      case "CHOOSE_LAST_CAP":
        await sendTg("sendMessage", {
          chat_id: chat_id, text: pickT(chat_id, "choose_last_cap_prompt"),
          reply_markup: { inline_keyboard: [ [ { text: pickT(chat_id, "btn_last_caption"), callback_data: "cap_use_last" }, { text: pickT(chat_id, "btn_new_caption"), callback_data: "cap_use_new" } ] ] }
        });
        break;
      case "PUB_CAP":
        await sendTg("sendMessage", {
          chat_id: chat_id, text: pickT(chat_id, "pub_cap"),
          reply_markup: { inline_keyboard: [ [ { text: pickT(chat_id, "btn_my_text"), callback_data: "capmode_exact" } ] ] }
        });
        break;
      case "PUB_DON":
        await sendTg("sendMessage", {
          chat_id: chat_id, text: pickT(chat_id, "pub_don"),
          reply_markup: { inline_keyboard: [ [ { text: pickT(chat_id, "btn_none"), callback_data: "none" } ] ] }
        });
        break;
      case "PUB_CLK":
        await sendTg("sendMessage", {
          chat_id: chat_id, text: pickT(chat_id, "pub_clk"),
          reply_markup: { inline_keyboard: [ [ { text: pickT(chat_id, "btn_none"), callback_data: "none" } ] ] }
        });
        break;
      case "PUB_EMO":
        await sendTg("sendMessage", {
          chat_id: chat_id, text: pickT(chat_id, "pub_emo"),
          reply_markup: { inline_keyboard: [
            [ { text: "🌚", callback_data: "emo_🌚" }, { text: "🔥", callback_data: "emo_🔥" }, { text: "💖", callback_data: "emo_💖" }, { text: "👍", callback_data: "emo_👍" } ],
            [ { text: "🎉", callback_data: "emo_🎉" }, { text: "👏", callback_data: "emo_👏" }, { text: "⭐", callback_data: "emo_⭐" } ]
          ] }
        });
        break;
      case "PUB_BUTTONS_CHOICE":
        await sendTg("sendMessage", {
          chat_id: chat_id, text: pickT(chat_id, "buttons_choice_prompt"),
          reply_markup: { inline_keyboard: [
            [ { text: pickT(chat_id, "btn_add_more"), callback_data: "pub_btn_add" } ],
            [ { text: pickT(chat_id, "btn_pub_now"), callback_data: "pub_now" } ]
          ] }
        });
        break;
    }
  } catch (err) {}
}

async function finalizePublish(chat_id, selectedEmoji) {
  const session = sessions[chat_id];
  if (!session || session.processing) return;
  session.processing = true;

  const p = session.publishData;
  
  let waitMsg = null;
  try {
    waitMsg = await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "processing_msg") });
  } catch (err) {}
  
  try {
    if (p.useAI !== false && p.originalCaption) {
      const aiResult = await runAIResult(p.originalCaption);
      p.caption = aiResult && aiResult.ok && aiResult.text ? aiResult.text : (p.originalCaption || "");
    } else {
      p.caption = p.originalCaption || "";
    }
  } catch (err) {
    p.caption = p.originalCaption || "";
  }
  
  const kb = [];
  const firstRow = [{ text: selectedEmoji + " 0", callback_data: "vote" }];
  
  if (p.donate && p.donate !== "none" && p.donate.trim() !== "") {
    firstRow.push({ text: "⭐", url: formatUrl(p.donate) });
  }
  kb.push(firstRow);
  
  let showSub = true;
  const targetLower = p.targetBot.toLowerCase();
  if (targetLower === "@dh7adam" || targetLower === "dh7adam" || targetLower === "https://t.me/dh7adam") {
    showSub = false;
  } else if (userCredits[chat_id] && userCredits[chat_id] > 0) {
    showSub = false;
    userCredits[chat_id]--;
    await saveData();
  }

  if (showSub) {
    kb.push([{ text: pickT(chat_id, "btn_subscribe"), url: "https://t.me/dh7adam" }]);
  }
  
  if (p.clicks && p.clicks !== "none" && p.clicks.trim() !== "") {
    kb.push([{ text: "Clicks", url: formatUrl(p.clicks) }]);
  }
  
  if (p.extraBtns && p.extraBtns.length > 0) {
    for (let i = 0; i < p.extraBtns.length; i++) {
        kb.push([{ text: p.extraBtns[i].text, url: p.extraBtns[i].url }]);
    }
  }
  
  const botId = parseInt(TELEGRAM_TOKEN.split(":")[0]);
  const isAdmin = await checkAdminRights(p.targetBot, botId);
  if (!isAdmin) {
    if (waitMsg && waitMsg.ok) await sendTg("deleteMessage", { chat_id: chat_id, message_id: waitMsg.result.message_id });
    await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "pub_err") });
    sessions[chat_id] = null;
    return;
  }
  
  let result = { ok: false };
  const mediaList = p.media || [];
  
  try {
    if (mediaList.length === 0) {
      result = await sendTg("sendMessage", {
        chat_id: p.targetBot,
        text: p.caption,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: kb }
      });
    } else if (mediaList.length === 1) {
      const mediaItem = mediaList[0];
      const payload = { chat_id: p.targetBot, caption: p.caption, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } };
      if (mediaItem.type === "video") {
        payload.video = mediaItem.fileId;
        result = await sendTg("sendVideo", payload);
      } else {
        payload.photo = mediaItem.fileId;
        result = await sendTg("sendPhoto", payload);
      }
    } else {
      if (p.mediaMode === "multiples") {
        const chunks = [];
        for (let i = 0; i < mediaList.length; i += 10) chunks.push(mediaList.slice(i, i + 10));

        let firstAlbumSent = false;
        for (const chunk of chunks) {
          const mediaGroup = chunk.map((item, idx) => {
            const obj = { type: item.type === "video" ? "video" : "photo", media: item.fileId };
            if (!firstAlbumSent && idx === 0) {
              obj.caption = p.caption;
              obj.parse_mode = "HTML";
            }
            return obj;
          });
          const groupRes = await sendTg("sendMediaGroup", { chat_id: p.targetBot, media: mediaGroup });
          if (groupRes.ok) firstAlbumSent = true;
        }

        if (firstAlbumSent) {
          result = await sendTg("sendMessage", { chat_id: p.targetBot, text: "👇", reply_markup: { inline_keyboard: kb } });
        } else {
          result = { ok: false, description: "Group transmission failed" };
        }
      } else {
        let totalDispatched = 0;
        for (const item of mediaList) {
          try {
            const payload = { chat_id: p.targetBot, caption: p.caption, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } };
            let singleRes;
            if (item.type === "video") {
              payload.video = item.fileId;
              singleRes = await sendTg("sendVideo", payload);
            } else {
              payload.photo = item.fileId;
              singleRes = await sendTg("sendPhoto", payload);
            }
            if (singleRes.ok) totalDispatched++;
          } catch (singleErr) {}
        }
        result = { ok: totalDispatched > 0, description: "Publié " + totalDispatched + "/" + mediaList.length + " médias." };
      }
    }
  } catch (publishError) {
    result = { ok: false, description: publishError.message };
  }
  
  if (waitMsg && waitMsg.ok) {
    try { await sendTg("deleteMessage", { chat_id: chat_id, message_id: waitMsg.result.message_id }); } catch (err) {}
  }
  
  if (result.ok) {
    await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "pub_done") });
    lastFormats[chat_id] = { targetBot: p.targetBot, donate: p.donate, clicks: p.clicks, emoji: selectedEmoji, caption: p.caption };
    await saveData();
  } else {
    await sendTg("sendMessage", { chat_id: chat_id, text: "Erreur d'envoi Telegram : " + (result.description || "Erreur de requête") });
  }
  
  try {
    if (sessions[chat_id]) {
      if (sessions[chat_id].mediaTimer) clearTimeout(sessions[chat_id].mediaTimer);
      if (sessions[chat_id].publishData && sessions[chat_id].publishData.media) {
        sessions[chat_id].publishData.media = [];
      }
    }
  } catch (cleanupErr) {}
  sessions[chat_id] = null;
}

async function processPublishTextStep(chat_id, text) {
  try {
    const s = sessions[chat_id];
    if (!s || !s.publishData) return false;
    const cleanValue = text.trim();
    const isNone = (cleanValue.toLowerCase() === "none" || cleanValue === "");
    
    if (s.step === "PUB_CAP") {
      s.publishData.originalCaption = text;
      if (s.publishData.useAI === undefined) s.publishData.useAI = true;
      if (s.publishData.isLastFormatUsed) await askStep(chat_id, "PUB_BUTTONS_CHOICE");
      else await askStep(chat_id, "PUB_DON");
      return true;
    }
    if (s.step === "PUB_DON") {
      s.publishData.donate = isNone ? null : cleanValue;
      await askStep(chat_id, "PUB_CLK");
      return true;
    }
    if (s.step === "PUB_CLK") {
      s.publishData.clicks = isNone ? null : cleanValue;
      await askStep(chat_id, "PUB_EMO");
      return true;
    }
    if (s.step === "PUB_EMO") {
      s.publishData.emoji = cleanValue;
      await askStep(chat_id, "PUB_BUTTONS_CHOICE");
      return true;
    }
    if (s.step === "PUB_BTN_NAME") {
      if (!isNone) {
          s.publishData.tempBtnName = cleanValue;
          s.step = "PUB_BTN_URL";
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "btn_url_prompt") });
      }
      return true;
    }
    if (s.step === "PUB_BTN_URL") {
      if (!isNone) {
          if (!s.publishData.extraBtns) s.publishData.extraBtns = [];
          s.publishData.extraBtns.push({ text: s.publishData.tempBtnName, url: formatUrl(cleanValue) });
      }
      await askStep(chat_id, "PUB_BUTTONS_CHOICE");
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

async function syncGetUser(tfid) {
  try {
    let memoryUser = memoryUserCache.get(tfid);
    let mongoUser = null;
    
    for (const m of userModels) {
      try {
        const u = await m.findOne({ tfid: tfid }).lean();
        if (u) {
          mongoUser = u;
          break;
        }
      } catch (e) {}
    }

    if (mongoUser) {
      const merged = { tfid: mongoUser.tfid, pwen: mongoUser.pwen || 0, lastPwenAdd: mongoUser.lastPwenAdd || 0, resan: mongoUser.resan || [] };
      memoryUserCache.set(tfid, merged);
      return merged;
    }
    if (memoryUser) return memoryUser;

    const newUser = { tfid: tfid, pwen: 0, lastPwenAdd: 0, resan: [] };
    memoryUserCache.set(tfid, newUser);
    return newUser;
  } catch (e) {
    return memoryUserCache.get(tfid) || { tfid: tfid, pwen: 0, lastPwenAdd: 0, resan: [] };
  }
}

async function syncUpdateUser(tfid, data) {
  try {
    const current = await syncGetUser(tfid);
    const updatedData = {
      tfid: tfid,
      pwen: data.pwen !== undefined ? data.pwen : current.pwen,
      lastPwenAdd: data.lastPwenAdd !== undefined ? data.lastPwenAdd : current.lastPwenAdd,
      resan: data.resan !== undefined ? data.resan : current.resan
    };
    memoryUserCache.set(tfid, updatedData);

    let saved = false;
    for (const m of userModels) {
      try {
        await m.updateOne({ tfid: tfid }, { pwen: updatedData.pwen, lastPwenAdd: updatedData.lastPwenAdd, resan: updatedData.resan }, { upsert: true });
        saved = true;
      } catch (e) {}
    }
    return { success: true, user: updatedData, syncedToMongo: saved };
  } catch (e) {
    return { success: true, user: memoryUserCache.get(tfid), syncedToMongo: false };
  }
}

function buildPublicUrl(key) {
  try {
    let baseUrl = BASE_URL || '';
    if (baseUrl) {
      if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
      return baseUrl + '/' + encodePathSegments(String(key || ''));
    }
    return 'https://poste.adamdh7.org/' + encodePathSegments(String(key || ''));
  } catch (e) {
    return key;
  }
}


function randomDigits(length = 7) {
  try {
    const chars = '0123456789';
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes).map(b => chars[b % chars.length]).join('');
  } catch (e) {
    return Math.floor(1000000 + Math.random() * 9000000).toString();
  }
}

function slugify(value) {
  try {
    return String(value || '').toLowerCase().trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  } catch (e) {
    return 'untitled';
  }
}

function extractTitle(content = {}, key = '') {
  return String(content.Name || content.Titre || content.title || content.name || key.split('/').pop() || 'untitled');
}

function extractCategoryAndLang(categoryStr) {
  try {
    const raw = String(categoryStr || 'inconnu').trim();
    const extracted = splitCategoryLanguage(raw);
    return { cat: extracted.cat || raw, lang: extracted.lang || null };
  } catch (e) {
    return { cat: 'inconnu', lang: null };
  }
}


function ensureTFID(content = {}, key = '') {
  try {
    const existing = String(content.TFID || content.tfid || '').trim();
    if (/^TF-\d{7}\/[^/]+\/[^/]+(\/[^/]+)?$/.test(existing)) return existing;

    const title = extractTitle(content, key);
    const rawCategory = String(content["Catégorie"] || content.Catégorie || content.category || 'inconnu');
    const extracted = extractCategoryAndLang(rawCategory);
    const catSegment = slugify(extracted.cat) || 'inconnu';
    const slug = slugify(title) || slugify(key.split('/').pop()) || 'untitled';
    
    if (extracted.lang) return "TF-" + randomDigits(7) + "/" + catSegment + "/" + slug + "/" + slugify(extracted.lang);
    return "TF-" + randomDigits(7) + "/" + catSegment + "/" + slug;
  } catch (e) {
    return "TF-" + randomDigits(7) + "/inconnu/untitled";
  }
}

function normalizeContent(content = {}, key = '') {
  try {
    const normalized = { ...(content || {}) };
    const recordKey = String(key || normalized.key || normalized.TFID || '').trim();
    const identityKey = /^TF-\d{7}\//i.test(recordKey) ? recordKey : ensureTFID(normalized, recordKey);
    normalized.TFID = identityKey;
    normalized.key = recordKey || identityKey;
    if (!normalized.slug && normalized.Name) normalized.slug = slugify(normalized.Name);
    return normalized;
  } catch (e) {
    return content;
  }
}


function contentTextBlob(content = {}) {
  try {
    return [
      content.TFID, content.key, content.Name, content.Titre, content.title, content.category, content.Catégorie,
      content.Description, content.Bio, content['Url Thumb'], content['Url Video'], content.thumb, content.videoUrl, content.slug
    ].filter(Boolean).join(' ');
  } catch (e) {
    return '';
  }
}

function levenshtein(a, b) {
  try {
    let t;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    if (a.length > b.length) { t = a; a = b; b = t; }
    const r = Array(a.length + 1).fill(0).map((_, i) => i);
    for (let i = 1; i <= b.length; i++) {
      let p = i;
      for (let j = 1; j <= a.length; j++) {
        const v = (b.charAt(i - 1) === a.charAt(j - 1)) ? r[j - 1] : Math.min(r[j - 1] + 1, p + 1, r[j] + 1);
        r[j - 1] = p;
        p = v;
      }
      r[a.length] = p;
    }
    return r[a.length];
  } catch (e) {
    return Math.max(a.length, b.length);
  }
}

function textScore(query, value, weight) {
  try {
    const text = String(value === null || value === undefined ? '' : value).toLowerCase().trim();
    if (!text || !query) return 0;
    let score = 0;
    if (text === query) score += 300 * weight;
    if (text.includes(query)) score += 80 * weight;
    const qWords = query.split(/\s+/).filter(Boolean);
    const tWords = text.split(/[\s/._-]+/).filter(Boolean);
    for (const qWord of qWords) {
      let bestMatchScore = 0;
      for (const tWord of tWords) {
        if (tWord === qWord) bestMatchScore = Math.max(bestMatchScore, 120);
        else if (tWord.includes(qWord) || qWord.includes(tWord)) bestMatchScore = Math.max(bestMatchScore, 70);
        else {
          const d = levenshtein(qWord, tWord);
          const maxLen = Math.max(qWord.length, tWord.length);
          const similarity = maxLen === 0 ? 0 : (maxLen - d) / maxLen;
          if (similarity >= 0.8) bestMatchScore = Math.max(bestMatchScore, 60);
          else if (similarity >= 0.6) bestMatchScore = Math.max(bestMatchScore, 40);
          else if (similarity >= 0.4) bestMatchScore = Math.max(bestMatchScore, 20);
          else if (similarity >= 0.2) bestMatchScore = Math.max(bestMatchScore, 8);
        }
      }
      score += bestMatchScore;
    }
    return score * weight;
  } catch (e) {
    return 0;
  }
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  try {
    const timestamp = new Date().toISOString();
    console.log("[REQUEST] " + timestamp + " - " + req.method + " " + req.url);
  } catch (e) {}
  next();
});

app.use((req, res, next) => {
  try {
    const getDomain = (str) => {
      try { return str ? new URL(str.startsWith('http') ? str : "http://" + str).hostname : ''; } catch (e) { return ''; }
    };

    const reqOrigin = req.headers.origin || '';
    const reqReferer = req.headers.referer || '';
    const originDomain = getDomain(reqOrigin);
    const refererDomain = getDomain(reqReferer);
    
    const isAllowedOrigin = (originDomain === 'poste.adamdh7.org' || refererDomain === 'poste.adamdh7.org' || (!reqOrigin && !reqReferer));

    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Origin', 'https://poste.adamdh7.org');
      res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range, Content-Length, x-auth-token, authorization');
      res.header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Type, Content-Disposition');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.status(200).end();
    }

    const token = req.headers['x-auth-token'] || req.headers['authorization'] || req.query.token || req.body?.token || '';
    const hasValidToken = String(token).trim() === 'adamdh7';
    const isSecretPath = req.path === '/adamdh7=modpas/adamdh7' || req.path.startsWith('/adamdh7=modpas/adamdh7/');
    const isPublicStatic = req.path === '/poste2.png' || req.path === '/sitemap.xml' || req.path === '/favicon.ico';
    const isTelegramHook = req.path === '/telegram';
    const isRoot = req.path === '/';
    const isTFRoute = req.path.includes('/TF-');

    let allowed = false;

    if (isRoot || isSecretPath || isPublicStatic || isTelegramHook || isTFRoute) allowed = true;
    else if (hasValidToken || isAllowedOrigin) allowed = true;

    if (!allowed) {
      return res.status(502).end();
    }

    res.header('Access-Control-Allow-Origin', 'https://poste.adamdh7.org');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range, Content-Length, x-auth-token, authorization');
    res.header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Type, Content-Disposition');
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
  } catch (e) {
    try { res.status(502).end(); } catch (err) {}
  }
});

app.post('/telegram', async (req, res) => {
  try {
    const update = req.body;
    if (!update) return res.status(200).end();

    const chatObj = update.message?.chat || update.callback_query?.message?.chat || update.my_chat_member?.chat;
    if (chatObj && (chatObj.type === "channel" || chatObj.type === "supergroup" || chatObj.type === "group")) {
      const formattedChat = formatTarget(chatObj.username ? chatObj.username : chatObj.id.toString());
      if (!allKnownChats.includes(formattedChat)) {
        allKnownChats.push(formattedChat);
        saveData();
      }
    }

    const fromId = update.message?.from?.id || update.callback_query?.from?.id;
    const validationChatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
    const chatType = update.message?.chat?.type || update.callback_query?.message?.chat?.type;

    if (fromId) assignLang(fromId, update.message?.from?.language_code || update.callback_query?.from?.language_code);

    const textMsg = update.message?.text || "";
    const cbData = update.callback_query?.data || "";
    const isLangCommand = textMsg.startsWith("/start") || textMsg.startsWith("/lang") || cbData.startsWith("lang_");

    if (update.message && chatType === "private" && textMsg.startsWith("/start ref_")) {
      const refStr = textMsg.split("ref_")[1];
      if (refStr) {
        const refId = parseInt(refStr);
        if (!isNaN(refId) && refId !== fromId) {
          userCredits[refId] = (userCredits[refId] || 0) + 7;
          saveData();
          await sendTg("sendMessage", { chat_id: refId, text: pickT(refId, "ref_success") });
        }
      }
    }

    if (chatType === "private" && fromId && validationChatId && !isLangCommand && cbData !== "vote") {
      const subRes = await sendTg("getChatMember", { chat_id: "@dh7adam", user_id: fromId });
      const isSubbed = subRes.ok && ["member", "administrator", "creator"].includes(subRes.result.status);
      
      if (!isSubbed) {
        const btn = [[{ text: pickT(validationChatId, "btn_subscribe"), url: "https://t.me/dh7adam" }]];
        await sendTg("sendMessage", { chat_id: validationChatId, text: pickT(validationChatId, "must_subscribe"), reply_markup: { inline_keyboard: btn } });
        if (update.callback_query) await sendTg("answerCallbackQuery", { callback_query_id: update.callback_query.id });
        return res.status(200).end();
      }
    }
    
    if (update.my_chat_member) {
      try {
        const chat = update.my_chat_member.chat;
        if (chat.type === "channel") {
          const targetUserId = update.my_chat_member.from.id;
          const formattedChannel = formatTarget(chat.username ? chat.username : chat.id.toString());
          if (!userBots[targetUserId]) userBots[targetUserId] = [];
          if (!userBots[targetUserId].includes(formattedChannel)) {
            userBots[targetUserId].push(formattedChannel);
            saveData();
          }
          const rawText = pickT(targetUserId, "bot_added");
          const channelDisplayName = chat.title || formattedChannel;
          const formattedText = rawText.replace("{channel}", channelDisplayName);
          const kb = [[{ text: pickT(targetUserId, "btn_pub_here"), callback_data: "pubbot_" + formattedChannel }]];
          await sendTg("sendMessage", { chat_id: targetUserId, text: formattedText, reply_markup: { inline_keyboard: kb } });
        }
      } catch (memberErr) {}
      return res.status(200).end();
    }
    
    if (update.callback_query) {
      try {
        const cb = update.callback_query;
        const chat_id = cb.message.chat.id;
        const data = cb.data;

        if (data !== "vote") {
          if (!activeMenus[chat_id] || cb.message.message_id !== activeMenus[chat_id]) {
            const expiredMsg = pickT(chat_id, "session_expired");
            await sendTg("answerCallbackQuery", { callback_query_id: cb.id, text: expiredMsg, show_alert: true });
            try { await sendTg("editMessageReplyMarkup", { chat_id: chat_id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch (err) {}
            return res.status(200).end();
          }
          activeMenus[chat_id] = null;
        }

        const requiresSession = data.startsWith("pubbot_") === false && data.startsWith("lang_") === false &&
                                data.startsWith("list_show_") === false && data.startsWith("del_") === false &&
                                data !== "vote" && data !== "pub_last_format";

        if (requiresSession && (!sessions[chat_id] || !sessions[chat_id].publishData)) {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id, text: pickT(chat_id, "session_expired"), show_alert: true });
          return res.status(200).end();
        }

        if (data === "vote") {
          try {
            const channelId = cb.message.chat.id;
            const messageId = cb.message.message_id;
            const voterId = cb.from.id;
            const voteKey = channelId + "_" + messageId;
            if (!votes[voteKey]) votes[voteKey] = [];
            if (votes[voteKey].includes(voterId)) {
              await sendTg("answerCallbackQuery", { callback_query_id: cb.id, text: pickT(voterId, "already_voted"), show_alert: true });
              return res.status(200).end();
            }
            votes[voteKey].push(voterId);
            saveData();
            const keyboard = cb.message.reply_markup.inline_keyboard;
            const voteButton = keyboard[0][0];
            const match = voteButton.text.match(/\d+$/);
            const count = match ? parseInt(match[0]) : 0;
            const newCount = count + 1;
            if (match) voteButton.text = voteButton.text.replace(/\d+$/, newCount.toString());
            else voteButton.text = voteButton.text + " " + newCount;
            await sendTg("editMessageReplyMarkup", { chat_id: channelId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } });
            await sendTg("answerCallbackQuery", { callback_query_id: cb.id, text: "+1!" });
          } catch (voteErr) {
            await sendTg("answerCallbackQuery", { callback_query_id: cb.id, text: "+1!" });
          }
          return res.status(200).end();
        }

        try { await sendTg("editMessageReplyMarkup", { chat_id: chat_id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch (editErr) {}

        if (data.startsWith("lang_")) {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          usersLang[chat_id] = data.split("_")[1];
          saveData();
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "info_text") });
          return res.status(200).end();
        }

        if (data.startsWith("list_show_")) {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id, text: data.substring(10), show_alert: true });
          return res.status(200).end();
        }

        if (data.startsWith("del_")) {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          const targetChan = data.substring(4);
          if (userBots[chat_id]) {
            userBots[chat_id] = userBots[chat_id].filter(b => b !== targetChan);
            saveData();
          }
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "del_success") });
          return res.status(200).end();
        }

        if (data.startsWith("pubbot_")) {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          sessions[chat_id] = { step: "PUB_IMG", publishData: { targetBot: data.substring(7), media: [], extraBtns: [] } };
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "pub_media_prompt"), reply_markup: { inline_keyboard: [[{ text: pickT(chat_id, "btn_def_img"), callback_data: "img_def" }], [{ text: pickT(chat_id, "btn_no_img"), callback_data: "img_none" }]] } });
          return res.status(200).end();
        }

        if (data === "pub_last_format") {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          const last = lastFormats[chat_id];
          sessions[chat_id] = {
            step: "PUB_IMG",
            publishData: { targetBot: last.targetBot, donate: last.donate, clicks: last.clicks, emoji: last.emoji, isLastFormatUsed: true, media: [], extraBtns: [] }
          };
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "pub_media_prompt"), reply_markup: { inline_keyboard: [[{ text: pickT(chat_id, "btn_def_img"), callback_data: "img_def" }], [{ text: pickT(chat_id, "btn_no_img"), callback_data: "img_none" }]] } });
          return res.status(200).end();
        }

        if (sessions[chat_id]?.step === "PUB_IMG" && (data === "img_def" || data === "img_none")) {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          sessions[chat_id].publishData.media = (data === "img_def") ? [{ type: "photo", fileId: defaultImage }] : [];
          if (sessions[chat_id].publishData.isLastFormatUsed) await askStep(chat_id, "CHOOSE_LAST_CAP");
          else await askStep(chat_id, "PUB_CAP");
          return res.status(200).end();
        }

        if (data.startsWith("mediamode_")) {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          sessions[chat_id].publishData.mediaMode = data.substring(10);
          if (sessions[chat_id].publishData.isLastFormatUsed) await askStep(chat_id, "CHOOSE_LAST_CAP");
          else if (sessions[chat_id].publishData.hasPreCaption) await askStep(chat_id, "PUB_DON");
          else await askStep(chat_id, "PUB_CAP");
          return res.status(200).end();
        }

        if (data === "capmode_exact") {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          sessions[chat_id].publishData.useAI = false;
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "send_cap_exact") });
          return res.status(200).end();
        }

        if (data === "cap_use_last") {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          const last = lastFormats[chat_id];
          sessions[chat_id].publishData.originalCaption = last.caption;
          sessions[chat_id].publishData.useAI = false;
          await askStep(chat_id, "PUB_BUTTONS_CHOICE");
          return res.status(200).end();
        }

        if (data === "cap_use_new") {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          await askStep(chat_id, "PUB_CAP");
          return res.status(200).end();
        }

        if (data === "none") {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          if (sessions[chat_id]?.step === "PUB_DON") {
            sessions[chat_id].publishData.donate = null;
            await askStep(chat_id, "PUB_CLK");
          } else if (sessions[chat_id]?.step === "PUB_CLK") {
            sessions[chat_id].publishData.clicks = null;
            await askStep(chat_id, "PUB_EMO");
          }
          return res.status(200).end();
        }

        if (sessions[chat_id]?.step === "PUB_EMO" && data.startsWith("emo_")) {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          sessions[chat_id].publishData.emoji = data.substring(4);
          await askStep(chat_id, "PUB_BUTTONS_CHOICE");
          return res.status(200).end();
        }
        
        if (sessions[chat_id]?.step === "PUB_BUTTONS_CHOICE") {
          await sendTg("answerCallbackQuery", { callback_query_id: cb.id });
          if (data === "pub_btn_add") {
            sessions[chat_id].step = "PUB_BTN_NAME";
            await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "btn_name_prompt") });
          } else if (data === "pub_now") {
            await finalizePublish(chat_id, sessions[chat_id].publishData.emoji);
          }
          return res.status(200).end();
        }
      } catch (cbErr) {}
      return res.status(200).end();
    }

    if (update.message) {
      try {
        const chat_id = update.message.chat.id;
        const text = update.message.text || "";
        
        if (activeMenus[chat_id]) {
          try { await sendTg("editMessageReplyMarkup", { chat_id: chat_id, message_id: activeMenus[chat_id], reply_markup: { inline_keyboard: [] } }); } catch (err) {}
          activeMenus[chat_id] = null;
        }

        if (text.startsWith("/")) {
          if (sessions[chat_id]) sessions[chat_id] = null;
        }
        
        if (text === "/start" || text === "/lang") {
          const langTarget = usersLang[chat_id] || "ht";
          await sendTg("sendMessage", {
            chat_id: chat_id,
            text: pickT(chat_id, "lang_welcome"),
            reply_markup: {
              inline_keyboard: [
                [ { text: "Kreyòl", callback_data: "lang_ht" }, { text: "Français", callback_data: "lang_fr" } ],
                [ { text: "Español", callback_data: "lang_es" }, { text: "English", callback_data: "lang_en" } ]
              ]
            }
          });
          return res.status(200).end();
        }

        if (text === "/add") {
          sessions[chat_id] = { step: "ADD_CHAN" };
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "add_prompt") });
          return res.status(200).end();
        }

        if (text === "/del") {
          let bots = userBots[chat_id] || [];
          if (bots.length === 0) {
            const waitMsg = await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "sync_msg") });
            bots = await syncUserBots(chat_id);
            if (waitMsg && waitMsg.ok) await sendTg("deleteMessage", { chat_id: chat_id, message_id: waitMsg.result.message_id });
          }
          if (bots.length === 0) {
            await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "list_empty") });
            return res.status(200).end();
          }
          sessions[chat_id] = { step: "DEL_CHAN" };
          const kb = bots.map(b => [{ text: b, callback_data: "del_" + b }]);
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "del_prompt"), reply_markup: { inline_keyboard: kb } });
          return res.status(200).end();
        }

        if (text === "/list") {
          let bots = userBots[chat_id] || [];
          if (bots.length === 0) {
            const waitMsg = await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "sync_msg") });
            bots = await syncUserBots(chat_id);
            if (waitMsg && waitMsg.ok) await sendTg("deleteMessage", { chat_id: chat_id, message_id: waitMsg.result.message_id });
          }
          if (bots.length === 0) {
            await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "list_empty") });
            return res.status(200).end();
          }
          const kb = bots.map(b => [{ text: b, callback_data: "list_show_" + b }]);
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "list_interactive"), reply_markup: { inline_keyboard: kb } });
          return res.status(200).end();
        }

        if (text === "/info") {
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "info_text") });
          return res.status(200).end();
        }

        if (text === "/adm") {
          const refLink = "https://t.me/" + BOT_USERNAME + "?start=ref_" + chat_id;
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "adm_text") + "\n\n" + refLink });
          return res.status(200).end();
        }

        if (text.startsWith("/pair")) {
          const parts = text.split(" ");
          if (parts.length > 1) {
            const number = parts[1].replace(/\D/g, "");
            try {
              const res = await fetch("https://tf.bot.adamdh7.org/get-code", {
                method: "POST", headers: {"Content-Type": "application/json"},
                body: JSON.stringify({ number: number, method: "code", autoExpire: true })
              });
              const data = await res.json();
              if (data.ok && data.code) await sendTg("sendMessage", { chat_id: chat_id, text: "<code>" + data.code + "</code>", parse_mode: "HTML" });
              else await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "pair_err") });
            } catch (err) { await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "pair_err") }); }
          } else {
            sessions[chat_id] = { step: "PAIR_NUMBER" };
            await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "pair_prompt") });
          }
          return res.status(200).end();
        }

        if (sessions[chat_id]?.step === "PAIR_NUMBER") {
          const number = text.replace(/\D/g, "");
          sessions[chat_id] = null;
          try {
            const res = await fetch("https://tf.bot.adamdh7.org/get-code", {
              method: "POST", headers: {"Content-Type": "application/json"},
              body: JSON.stringify({ number: number, method: "code", autoExpire: true })
            });
            const data = await res.json();
            if (data.ok && data.code) await sendTg("sendMessage", { chat_id: chat_id, text: "<code>" + data.code + "</code>", parse_mode: "HTML" });
            else await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "pair_err") });
          } catch (err) { await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "pair_err") }); }
          return res.status(200).end();
        }

        if (text === "/publish") {
          let bots = userBots[chat_id] || [];
          if (bots.length === 0) {
            const waitMsg = await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "sync_msg") });
            bots = await syncUserBots(chat_id);
            if (waitMsg && waitMsg.ok) await sendTg("deleteMessage", { chat_id: chat_id, message_id: waitMsg.result.message_id });
          }
          if (bots.length === 0) {
            await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "list_empty") });
            return res.status(200).end();
          }
          const kb = bots.map(b => [{ text: b, callback_data: "pubbot_" + b }]);
          if (lastFormats[chat_id]) kb.unshift([{ text: pickT(chat_id, "pub_last_format_btn"), callback_data: "pub_last_format" }]);
          await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "pub_bot"), reply_markup: { inline_keyboard: kb } });
          return res.status(200).end();
        }

        if (sessions[chat_id]?.step === "PUB_IMG") {
          let fileId = null;
          let type = null;
          
          if (update.message.photo) {
            const photos = update.message.photo;
            fileId = photos[photos.length - 1].file_id;
            type = "photo";
          } else if (update.message.video) {
            fileId = update.message.video.file_id;
            type = "video";
          }
          
          if (fileId) {
            if (!sessions[chat_id].publishData) sessions[chat_id].publishData = { media: [], extraBtns: [] };
            sessions[chat_id].publishData.media = sessions[chat_id].publishData.media || [];
            sessions[chat_id].publishData.media.push({ type: type, fileId: fileId });
            
            const caption = update.message.caption;
            if (caption && caption.trim() !== "") {
              sessions[chat_id].publishData.originalCaption = caption;
              sessions[chat_id].publishData.useAI = false;
              sessions[chat_id].publishData.hasPreCaption = true;
            }
            
            if (sessions[chat_id].mediaTimer) clearTimeout(sessions[chat_id].mediaTimer);
            
            sessions[chat_id].mediaTimer = setTimeout(async () => {
              try {
                const mediaList = sessions[chat_id].publishData.media || [];
                if (mediaList.length > 1) {
                  sessions[chat_id].step = "CHOOSE_MEDIA_MODE";
                  await sendTg("sendMessage", {
                    chat_id: chat_id,
                    text: pickT(chat_id, "media_mode_prompt"),
                    reply_markup: {
                      inline_keyboard: [ [ { text: pickT(chat_id, "btn_multiples"), callback_data: "mediamode_multiples" }, { text: pickT(chat_id, "btn_onebyone"), callback_data: "mediamode_onebyone" } ] ]
                    }
                  });
                } else {
                  if (sessions[chat_id].publishData.isLastFormatUsed) await askStep(chat_id, "CHOOSE_LAST_CAP");
                  else if (sessions[chat_id].publishData.hasPreCaption) await askStep(chat_id, "PUB_DON");
                  else await askStep(chat_id, "PUB_CAP");
                }
              } catch (timeoutErr) {}
            }, 2000);
            return res.status(200).end();
          }
        }

        if (sessions[chat_id]?.step === "ADD_CHAN") {
          const rawTargets = text.split(/[\n, ]+/).filter(t => t.trim() !== "");
          let successCount = 0;
          let existCount = 0;
          let errMsgs = [];
          const botId = parseInt(TELEGRAM_TOKEN.split(":")[0]);
          
          for (const rawTarget of rawTargets) {
            const formatted = formatTarget(rawTarget);
            const botIsAdmin = await checkAdminRights(formatted, botId);
            const userIsAdmin = await checkAdminRights(formatted, chat_id);
            
            if (!botIsAdmin) errMsgs.push(formatted + " : " + pickT(chat_id, "err_bot_not_admin"));
            else if (!userIsAdmin) errMsgs.push(formatted + " : " + pickT(chat_id, "err_user_not_admin"));
            else {
              if (!userBots[chat_id]) userBots[chat_id] = [];
              if (userBots[chat_id].includes(formatted)) existCount++;
              else { userBots[chat_id].push(formatted); successCount++; }
            }
          }
          if (successCount > 0) saveData();

          if (rawTargets.length === 1) {
            if (errMsgs.length > 0) await sendTg("sendMessage", { chat_id: chat_id, text: errMsgs[0] });
            else if (existCount > 0) await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "add_exists") });
            else await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "add_success") });
          } else {
            let finalMsg = "";
            if (successCount > 0) finalMsg += "" + successCount + " OK.\n";
            if (existCount > 0) finalMsg += "" + existCount + " EXIST.\n";
            if (errMsgs.length > 0) finalMsg += "\nERREURS:\n" + errMsgs.join("\n\n");
            await sendTg("sendMessage", { chat_id: chat_id, text: finalMsg });
          }
          sessions[chat_id] = null;
          return res.status(200).end();
        }

        if (sessions[chat_id]?.step === "DEL_CHAN") {
          const rawTargets = text.split(/[\n, ]+/).filter(t => t.trim() !== "");
          let removedCount = 0;
          if (userBots[chat_id]) {
            for (const rawTarget of rawTargets) {
              const formatted = formatTarget(rawTarget);
              const index = userBots[chat_id].indexOf(formatted);
              if (index > -1) { userBots[chat_id].splice(index, 1); removedCount++; }
            }
          }
          if (removedCount > 0) {
            saveData();
            await sendTg("sendMessage", { chat_id: chat_id, text: pickT(chat_id, "del_success") });
          }
          sessions[chat_id] = null;
          return res.status(200).end();
        }

        const isTextFlow = await processPublishTextStep(chat_id, text);
        if (isTextFlow) return res.status(200).end();
        
      } catch (msgErr) {}
    }
  } catch (globalErr) {}
  return res.status(200).end();
});

const { ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');

async function readAllDocsDetailed() {
  try {
    const results = await Promise.allSettled(
      models.map(async (model, modelIndex) => {
        const docs = await model.find().lean();
        return docs.map(doc => ({ model: model, modelIndex: modelIndex, key: doc.key, content: doc.content || {} }));
      })
    );
    const combined = [];
    for (const res of results) {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) combined.push(...res.value);
    }
    return combined;
  } catch (e) {
    return [];
  }
}

async function persistContent(model, key, content) {
  try {
    await model.updateOne({ key: key }, { content: content }, { upsert: true });
    return true;
  } catch (e) { return false; }
}

function isSupportedLangToken(value) {
  return ['fr', 'es', 'en', 'ht'].includes(String(value || '').trim().toLowerCase());
}

function normalizeLangCode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (isSupportedLangToken(raw)) return raw;
  const parts = raw.split(/[^a-z]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (isSupportedLangToken(parts[i])) return parts[i];
  }
  return '';
}

function getKeyLanguage(key) {
  const parts = String(key || '').trim().split('/').filter(Boolean);
  if (!parts.length) return '';
  const lastPart = parts[parts.length - 1].trim().toLowerCase();
  return isSupportedLangToken(lastPart) ? lastPart : '';
}

function splitCategoryLanguage(value) {
  const raw = String(value || '').trim();
  if (!raw) return { cat: '', lang: '' };
  const parts = raw.split('/').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return { cat: '', lang: '' };
  if (parts.length > 1 && isSupportedLangToken(parts[0].toLowerCase())) {
    return { cat: parts.slice(1).join('/'), lang: parts[0].toLowerCase() };
  }
  const lastPart = parts[parts.length - 1].toLowerCase();
  if (parts.length > 1 && isSupportedLangToken(lastPart)) {
    return { cat: parts.slice(0, -1).join('/'), lang: lastPart };
  }
  if (parts.length === 1 && isSupportedLangToken(lastPart)) return { cat: '', lang: lastPart };
  return { cat: raw, lang: '' };
}

function getContentLanguage(content) {
  if (!content || typeof content !== 'object') return '';
  const identityLanguage = getKeyLanguage(content.TFID || content.key || content.tfid || '');
  if (identityLanguage) return identityLanguage;
  const explicitLanguage = normalizeLangCode(content.lang || content.language || content.langue || '');
  if (explicitLanguage) return explicitLanguage;
  const category = content['Catégorie'] || content.category || content.Catégorie || '';
  return splitCategoryLanguage(category).lang || '';
}

function getContentMetadataLanguage(content) {
  if (!content || typeof content !== 'object') return '';
  const explicitLanguage = normalizeLangCode(content.lang || content.language || content.langue || '');
  if (explicitLanguage) return explicitLanguage;
  const category = content['Catégorie'] || content.category || content.Catégorie || '';
  return splitCategoryLanguage(category).lang || '';
}

function buildCanonicalKey(key, content = {}) {
  const rawKey = String(key || '').trim();
  if (!rawKey) return '';
  const parts = rawKey.split('/').filter(Boolean);
  const keyLang = getKeyLanguage(rawKey);
  const contentLang = getContentMetadataLanguage(content);
  if (keyLang) return parts.slice(0, -1).join('/') + '/' + keyLang;
  if (!contentLang) return rawKey;
  return rawKey + '/' + contentLang;
}


function buildCanonicalCategory(category, lang) {
  const raw = String(category || '').trim();
  if (!raw) return raw;
  const extracted = splitCategoryLanguage(raw);
  const finalLang = normalizeLangCode(lang || extracted.lang);
  if (!finalLang) return raw;
  const base = extracted.cat || raw.replace(new RegExp('\/+(fr|es|en|ht)(?:[-_].*)?$', 'i'), '');
  if (!base) return finalLang.toUpperCase();
  return base + '/' + finalLang.toUpperCase();
}

function getTranslationFamilyKey(key, content = {}) {
  const canonicalKey = buildCanonicalKey(key, content);
  if (!canonicalKey) return '';
  const parts = String(canonicalKey).split('/').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return '';
  const lastPart = parts[parts.length - 1];
  const lastLang = getKeyLanguage(canonicalKey);
  if (lastLang) return parts.slice(0, -1).join('/');
  return canonicalKey;
}

function buildTranslationVariantKey(baseKey, lang) {
  const familyKey = getTranslationFamilyKey(baseKey, {});
  const finalLang = normalizeLangCode(lang);
  if (!familyKey || !finalLang) return familyKey || String(baseKey || '').trim();
  return familyKey + '/' + finalLang;
}

function normalizeRecordForOutput(content, key) {
  const canonicalKey = buildCanonicalKey(key, content);
  const normalized = normalizeContent(content || {}, canonicalKey);
  const lang = getKeyLanguage(canonicalKey) || getContentLanguage(normalized);
  normalized.key = canonicalKey;
  normalized.TFID = canonicalKey;
  if (lang) {
    const cat = normalized["Catégorie"] || normalized.category || '';
    const canonicalCategory = buildCanonicalCategory(cat, lang);
    normalized["Catégorie"] = canonicalCategory;
    normalized.category = canonicalCategory;
  }
  return normalized;
}

async function findRecordByKey(model, key, content = {}) {
  const rawKey = String(key || '').trim();
  if (!rawKey) return null;
  try {
    const exact = await model.findOne({ key: rawKey });
    if (exact) return { doc: exact, key: rawKey };
  } catch (e) {}
  const canonicalKey = buildCanonicalKey(rawKey, content);
  if (canonicalKey && canonicalKey !== rawKey) {
    try {
      const canonical = await model.findOne({ key: canonicalKey });
      if (canonical) return { doc: canonical, key: canonicalKey };
    } catch (e) {}
  }
  return null;
}


async function fixMissingTFIDs(records) {
  try {
    const tasks = [];
    for (const record of records) {
      const normalized = normalizeContent(record.content, record.key);
      if (normalized.TFID !== record.content.TFID) tasks.push(persistContent(record.model, record.key, normalized));
      record.content = normalized;
    }
    await Promise.allSettled(tasks);
    return records;
  } catch (e) { return records; }
}



const translationQueuePath = path.join(process.cwd(), 'translation_queue.json');
const translationQueueDelayMs = 15 * 60 * 1000;
let translationQueueCache = new Map();
let translationQueueLoadPromise = null;
let translationQueueSaveTimer = null;
let translationQueueSaveChain = Promise.resolve();
let translationQueueProcessTimer = null;
let translationQueueProcessing = false;

function getAICandidateConfigs() {
  const candidates = [
    { accountId: BOT_CF_ACCOUNT_ID, apiToken: BOT_CF_API_TOKEN },
    { accountId: process.env.CF_ACCOUNT_ID, apiToken: process.env.CF_AI_TOKEN },
    { accountId: process.env.CF_AI_ACCOUNT_1, apiToken: process.env.CF_AI_TOKEN_1 },
    { accountId: process.env.CF_AI_ACCOUNT_2, apiToken: process.env.CF_AI_TOKEN_2 },
    { accountId: process.env.CF_AI_ACCOUNT_3, apiToken: process.env.CF_AI_TOKEN_3 },
    { accountId: process.env.CF_AI_ACCOUNT_4, apiToken: process.env.CF_AI_TOKEN_4 }
  ];
  const seen = new Set();
  return candidates.filter(item => {
    const accountId = String(item.accountId || '').trim();
    const apiToken = String(item.apiToken || '').trim();
    if (!accountId || !apiToken) return false;
    const key = accountId + '::' + apiToken;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isQuotaLikeAiError(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('quota') || text.includes('rate limit') || text.includes('ratelimit') || text.includes('too many requests') || text.includes('429') || text.includes('insufficient credits') || text.includes('credit') || text.includes('billing') || text.includes('limit reached') || text.includes('overloaded');
}

async function runAIResult(userPrompt) {
  const candidates = getAICandidateConfigs();
  let lastError = '';
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    try {
      const url = 'https://api.cloudflare.com/client/v4/accounts/' + candidate.accountId + '/ai/run/@cf/meta/llama-3.1-70b-instruct';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + candidate.apiToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: `You are Asistan.

Pipeline Rules:
- User input is draft text for direct publication only.
- Correct spelling, grammar, punctuation and apply requested formatting/translation.
- NEVER change meaning, tone, vulgarity or intensity. Never soften or censor.
- Output MUST be the final cleaned text and NOTHING ELSE.
- Never write introductions, explanations, notes, warnings, disclaimers or any surrounding text.` },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1700
        })
      });
      const raw = await res.text();
      let json = null;
      try { json = JSON.parse(raw); } catch (e) { json = null; }
      if (res.ok && json && json.success && json.result && typeof json.result.response === 'string' && json.result.response.trim() !== '') {
        return { ok: true, text: json.result.response, providerIndex: index, accountId: candidate.accountId };
      }
      if (json && json.result && typeof json.result.response === 'string' && json.result.response.trim() !== '') {
        return { ok: true, text: json.result.response, providerIndex: index, accountId: candidate.accountId };
      }
      lastError = raw || ('HTTP ' + res.status);
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
    }
  }
  return { ok: false, text: userPrompt, error: lastError, quota: isQuotaLikeAiError(lastError) };
}

async function runAI(userPrompt) {
  const result = await runAIResult(userPrompt);
  return result.ok ? result.text : userPrompt;
}

function translationJobId(sourceKey, targetLang) {
  return String(sourceKey || '').trim() + '::' + normalizeLangCode(targetLang);
}

function serializeTranslationQueue() {
  return Array.from(translationQueueCache.values());
}

async function saveTranslationQueueNow() {
  const saveTask = async () => {
    const payload = JSON.stringify({ version: 2, items: serializeTranslationQueue() }, null, 2);
    const tempPath = translationQueuePath + '.tmp';
    try {
      await fs.promises.writeFile(tempPath, payload, 'utf8');
      await fs.promises.rename(tempPath, translationQueuePath);
      return true;
    } catch (e) {
      try { await fs.promises.unlink(tempPath); } catch (ignore) {}
      return false;
    }
  };
  translationQueueSaveChain = translationQueueSaveChain.catch(() => false).then(saveTask);
  return translationQueueSaveChain;
}

function scheduleTranslationQueueSave() {
  if (translationQueueSaveTimer) return;
  translationQueueSaveTimer = setTimeout(() => {
    translationQueueSaveTimer = null;
    saveTranslationQueueNow().catch(() => {});
  }, 100);
}

async function flushTranslationQueue() {
  if (translationQueueSaveTimer) {
    clearTimeout(translationQueueSaveTimer);
    translationQueueSaveTimer = null;
  }
  return saveTranslationQueueNow();
}

async function loadTranslationQueueFromDisk() {
  if (translationQueueLoadPromise) return translationQueueLoadPromise;
  translationQueueLoadPromise = (async () => {
    try {
      const raw = await fs.promises.readFile(translationQueuePath, 'utf8');
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
      translationQueueCache = new Map();
      for (const item of items) {
        if (!item || !item.sourceKey || !item.targetLang) continue;
        const sourceKey = String(item.sourceKey || '').trim();
        const targetLang = normalizeLangCode(item.targetLang);
        if (!sourceKey || !targetLang) continue;
        const jobId = translationJobId(sourceKey, targetLang);
        translationQueueCache.set(jobId, {
          jobId: jobId,
          sourceKey: sourceKey,
          sourceFamilyKey: String(item.sourceFamilyKey || getTranslationFamilyKey(sourceKey, {})).trim(),
          targetLang: targetLang,
          targetKey: String(item.targetKey || buildTranslationVariantKey(item.sourceFamilyKey || sourceKey, targetLang) || '').trim(),
          modelIndex: Number.isInteger(item.modelIndex) ? item.modelIndex : 0,
          sourceLang: normalizeLangCode(item.sourceLang || ''),
          sourceUpdatedAt: Number.isFinite(item.sourceUpdatedAt) ? item.sourceUpdatedAt : 0,
          updateExisting: item.updateExisting === true,
          attempts: Number.isFinite(item.attempts) ? item.attempts : 0,
          nextRunAt: Number.isFinite(item.nextRunAt) ? item.nextRunAt : 0,
          lastError: String(item.lastError || ''),
          createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
          updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
        });
      }
    } catch (e) {
      translationQueueCache = new Map();
    }
  })();
  return translationQueueLoadPromise;
}

async function findRecordByKeyAcrossModels(key, content = {}) {
  const rawKey = String(key || '').trim();
  if (!rawKey) return null;
  for (let i = 0; i < models.length; i++) {
    try {
      const found = await findRecordByKey(models[i], rawKey, content);
      if (found && found.doc) return { model: models[i], modelIndex: i, key: found.key, doc: found.doc };
    } catch (e) {}
  }
  return null;
}

async function findRecordByFingerprint(fingerprint) {
  if (!fingerprint) return null;
  for (let i = 0; i < models.length; i++) {
    try {
      const doc = await models[i].findOne({ requestFingerprint: fingerprint }).lean();
      if (doc) return { model: models[i], modelIndex: i, key: doc.key, doc: doc };
    } catch (e) {}
  }
  return null;
}

function translationRetryDelay(attempts) {
  const exponent = Math.min(Math.max(Number(attempts || 1) - 1, 0), 8);
  return Math.min(translationQueueDelayMs, 5000 * Math.pow(2, exponent));
}

function retryTranslationJob(job, error) {
  job.attempts = Number(job.attempts || 0) + 1;
  job.lastError = String(error || 'Translation failed').slice(0, 2000);
  job.nextRunAt = Date.now() + translationRetryDelay(job.attempts);
  job.updatedAt = Date.now();
  translationQueueCache.set(job.jobId, job);
}

function scheduleTranslationQueueProcessing(delayMs = 0) {
  if (translationQueueProcessTimer) clearTimeout(translationQueueProcessTimer);
  translationQueueProcessTimer = setTimeout(() => {
    translationQueueProcessTimer = null;
    processTranslationQueue({ reason: 'scheduled' }).catch(() => {});
  }, Math.max(0, delayMs));
}

function scheduleNextTranslationQueueProcessing() {
  if (translationQueueProcessTimer) {
    clearTimeout(translationQueueProcessTimer);
    translationQueueProcessTimer = null;
  }
  const jobs = Array.from(translationQueueCache.values());
  if (!jobs.length) return;
  const nextRunAt = Math.min(...jobs.map(job => Number(job.nextRunAt || 0)));
  scheduleTranslationQueueProcessing(Math.max(0, nextRunAt - Date.now()));
}

async function enqueueTranslationJobsForContent(key, content, meta = {}) {
  try {
    await loadTranslationQueueFromDisk();
    const canonicalKey = buildCanonicalKey(key, content);
    if (!canonicalKey) return [];
    const sourceRecord = await findRecordByKeyAcrossModels(canonicalKey, content);
    const sourceContent = normalizeRecordForOutput(sourceRecord && sourceRecord.doc ? sourceRecord.doc.content || content : content, sourceRecord && sourceRecord.key ? sourceRecord.key : canonicalKey);
    const sourceLang = getKeyLanguage(canonicalKey) || getContentLanguage(sourceContent);
    if (sourceLang !== 'fr') return [];
    const sourceFamilyKey = getTranslationFamilyKey(canonicalKey, sourceContent);
    if (!sourceFamilyKey) return [];
    const sourceUpdatedAt = Number(sourceContent.updatedAt || 0);
    const jobs = [];
    for (const targetLang of ['en', 'es']) {
      const targetKey = buildTranslationVariantKey(sourceFamilyKey, targetLang);
      if (!targetKey) continue;
      const targetRecord = await findRecordByKeyAcrossModels(targetKey, {});
      const targetContent = targetRecord && targetRecord.doc ? targetRecord.doc.content || {} : null;
      const targetManaged = !!(targetContent && targetContent._translationSourceKey === canonicalKey);
      const targetCurrent = !!(targetManaged && Number(targetContent._translationSourceUpdatedAt || 0) === sourceUpdatedAt);
      const jobId = translationJobId(canonicalKey, targetLang);
      if (targetRecord && targetRecord.doc && (!targetManaged || targetCurrent)) {
        if (translationQueueCache.delete(jobId)) scheduleTranslationQueueSave();
        continue;
      }
      const existing = translationQueueCache.get(jobId);
      const sourceChanged = existing && Number(existing.sourceUpdatedAt || 0) !== sourceUpdatedAt;
      const job = existing || {
        jobId: jobId,
        sourceKey: canonicalKey,
        sourceFamilyKey: sourceFamilyKey,
        targetLang: targetLang,
        targetKey: targetKey,
        modelIndex: Number.isInteger(meta.modelIndex) ? meta.modelIndex : (sourceRecord ? sourceRecord.modelIndex : 0),
        sourceLang: 'fr',
        sourceUpdatedAt: sourceUpdatedAt,
        updateExisting: targetManaged,
        attempts: 0,
        nextRunAt: Date.now(),
        lastError: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      job.sourceKey = canonicalKey;
      job.sourceFamilyKey = sourceFamilyKey;
      job.targetLang = targetLang;
      job.targetKey = targetKey;
      job.modelIndex = Number.isInteger(meta.modelIndex) ? meta.modelIndex : (sourceRecord ? sourceRecord.modelIndex : job.modelIndex || 0);
      job.sourceLang = 'fr';
      job.sourceUpdatedAt = sourceUpdatedAt;
      job.updateExisting = targetManaged;
      if (sourceChanged) {
        job.attempts = 0;
        job.lastError = '';
      }
      job.nextRunAt = Date.now();
      job.updatedAt = Date.now();
      translationQueueCache.set(jobId, job);
      jobs.push(job);
    }
    if (jobs.length > 0) await flushTranslationQueue();
    return jobs;
  } catch (e) {
    return [];
  }
}

async function persistTranslationTarget(job, targetContent, sourceModelIndex, updateExisting) {
  const preferredIndex = Number.isInteger(job.modelIndex) ? job.modelIndex : (Number.isInteger(sourceModelIndex) ? sourceModelIndex : 0);
  const indexes = [];
  if (models[preferredIndex]) indexes.push(preferredIndex);
  for (let i = 0; i < models.length; i++) if (i !== preferredIndex && models[i]) indexes.push(i);
  for (const index of indexes) {
    const model = models[index];
    try {
      const existing = await model.findOne({ key: job.targetKey }).lean();
      if (existing) {
        if (!updateExisting || !existing.content || existing.content._translationSourceKey !== job.sourceKey) return false;
        const updateResult = await model.updateOne(
          { key: job.targetKey, 'content._translationSourceKey': job.sourceKey },
          { $set: { content: targetContent } }
        );
        if (updateResult.matchedCount > 0) return true;
        continue;
      }
      await model.create({ key: job.targetKey, content: targetContent });
      return true;
    } catch (e) {
      if (e && e.code === 11000) return false;
    }
  }
  return false;
}

async function processTranslationQueue({ reason = 'manual', force = false } = {}) {
  if (translationQueueProcessing) return { ok: false, busy: true, reason: reason };
  translationQueueProcessing = true;
  try {
    await loadTranslationQueueFromDisk();
    const now = Date.now();
    const pending = Array.from(translationQueueCache.values()).filter(job => force || !job.nextRunAt || job.nextRunAt <= now);
    pending.sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0) || (a.createdAt || 0) - (b.createdAt || 0));
    let processed = 0;
    for (const job of pending) {
      if (!translationQueueCache.has(job.jobId)) continue;
      const sourceRecord = await findRecordByKeyAcrossModels(job.sourceKey, {});
      if (!sourceRecord || !sourceRecord.doc) {
        retryTranslationJob(job, 'Source record temporarily unavailable');
        await saveTranslationQueueNow();
        continue;
      }
      const sourceContent = normalizeRecordForOutput(sourceRecord.doc.content || {}, sourceRecord.key);
      const currentLang = getKeyLanguage(sourceRecord.key) || getContentLanguage(sourceContent) || job.sourceLang || '';
      if (currentLang !== 'fr') {
        translationQueueCache.delete(job.jobId);
        await saveTranslationQueueNow();
        continue;
      }
      const sourceUpdatedAt = Number(sourceContent.updatedAt || 0);
      if (Number(job.sourceUpdatedAt || 0) !== sourceUpdatedAt) {
        job.sourceUpdatedAt = sourceUpdatedAt;
        job.attempts = 0;
        job.lastError = '';
        job.nextRunAt = Date.now();
        job.updatedAt = Date.now();
        translationQueueCache.set(job.jobId, job);
      }
      const targetRecord = await findRecordByKeyAcrossModels(job.targetKey, {});
      const targetSavedContent = targetRecord && targetRecord.doc ? targetRecord.doc.content || {} : null;
      const targetManaged = !!(targetSavedContent && targetSavedContent._translationSourceKey === job.sourceKey);
      const targetCurrent = !!(targetManaged && Number(targetSavedContent._translationSourceUpdatedAt || 0) === sourceUpdatedAt);
      if (targetRecord && targetRecord.doc && (!targetManaged || targetCurrent)) {
        translationQueueCache.delete(job.jobId);
        await saveTranslationQueueNow();
        continue;
      }
      job.updateExisting = targetManaged;
      const payload = {
        name: String(sourceContent.Name || sourceContent.Titre || ''),
        description: String(sourceContent.Description || ''),
        bio: String(sourceContent.Bio || '')
      };
      const targetLanguageName = job.targetLang === 'en' ? 'ENGLISH' : 'SPANISH';
      const prompt = 'Translate the non-empty JSON string values below strictly into ' + targetLanguageName + '. Keep the exact same keys (name, description, bio). Preserve empty strings as empty strings. Translate every non-empty field; never copy source-language text as a fallback. Return only valid JSON without markdown or explanation. JSON: ' + JSON.stringify(payload);
      const aiResult = await runAIResult(prompt);
      if (!aiResult.ok || typeof aiResult.text !== 'string' || aiResult.text.trim() === '') {
        retryTranslationJob(job, aiResult.error || 'AI error');
        await saveTranslationQueueNow();
        continue;
      }
      let translated = null;
      try {
        const match = aiResult.text.match(/\{[\s\S]*\}/);
        translated = JSON.parse(match ? match[0] : aiResult.text);
      } catch (e) {}
      const translatedFields = ['name', 'description', 'bio'];
      const validTranslation = !!translated && typeof translated === 'object' && translatedFields.every(field => {
        if (!String(payload[field] || '').trim()) return typeof translated[field] === 'string';
        return typeof translated[field] === 'string' && translated[field].trim() !== '';
      });
      if (!validTranslation) {
        retryTranslationJob(job, 'Invalid or incomplete translation JSON');
        await saveTranslationQueueNow();
        continue;
      }
      const latestSourceRecord = await findRecordByKeyAcrossModels(job.sourceKey, {});
      if (!translationQueueCache.has(job.jobId)) continue;
      if (!latestSourceRecord || !latestSourceRecord.doc) {
        translationQueueCache.delete(job.jobId);
        await saveTranslationQueueNow();
        continue;
      }
      const latestSourceContent = latestSourceRecord.doc.content || {};
      const latestSourceUpdatedAt = Number(latestSourceContent.updatedAt || 0);
      if (latestSourceUpdatedAt !== sourceUpdatedAt) {
        job.sourceUpdatedAt = Math.max(0, latestSourceUpdatedAt);
        job.attempts = 0;
        job.lastError = 'Source changed while translating; retrying current version';
        job.nextRunAt = Date.now() + 1000;
        job.updatedAt = Date.now();
        translationQueueCache.set(job.jobId, job);
        await saveTranslationQueueNow();
        continue;
      }
      const targetContent = Object.assign({}, sourceContent);
      targetContent.Name = String(payload.name.trim() ? translated.name.trim() : '');
      targetContent.Description = String(payload.description.trim() ? translated.description.trim() : '');
      targetContent.Bio = String(payload.bio.trim() ? translated.bio.trim() : '');
      targetContent['Url Video'] = '';
      targetContent.videoUrl = '';
      targetContent['Catégorie'] = buildCanonicalCategory(sourceContent['Catégorie'] || sourceContent.category || '', job.targetLang);
      targetContent.category = targetContent['Catégorie'];
      targetContent.TFID = job.targetKey;
      targetContent.key = job.targetKey;
      targetContent._translationSourceKey = job.sourceKey;
      targetContent._translationSourceUpdatedAt = sourceUpdatedAt;
      targetContent._translationTargetLang = job.targetLang;
      targetContent._translationGeneratedAt = Date.now();
      targetContent.updatedAt = Date.now();
      const saved = await persistTranslationTarget(job, targetContent, sourceRecord.modelIndex, targetManaged);
      if (saved) {
        translationQueueCache.delete(job.jobId);
        processed++;
      } else {
        retryTranslationJob(job, 'Target persist failed or changed concurrently');
      }
      await saveTranslationQueueNow();
    }
    return { ok: true, processed: processed, reason: reason };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), reason: reason };
  } finally {
    translationQueueProcessing = false;
    scheduleNextTranslationQueueProcessing();
  }
}

async function autoTranslateDocs() {
  try {
    await loadTranslationQueueFromDisk();
    const records = await readAllDocsDetailed();
    await fixMissingTFIDs(records);
    for (const record of records) {
      try {
        const key = String(record.key || '').trim();
        const content = normalizeRecordForOutput(record.content || {}, key);
        const language = getKeyLanguage(key) || getContentLanguage(content);
        if (language === 'fr' && !content._translationSourceKey) {
          await enqueueTranslationJobsForContent(key, content, { modelIndex: record.modelIndex });
        }
      } catch (recordError) {}
    }
    await processTranslationQueue({ reason: 'startup', force: false });
  } catch (e) {}
}


async function getNormalizedUniqueItems({ filterFn = null, limit = null, sortNewestFirst = true } = {}) {
  try {
    const records = await readAllDocsDetailed();
    await fixMissingTFIDs(records);
    const unique = new Map();
    for (const record of records) {
      const canonicalKey = buildCanonicalKey(record.key, record.content);
      const normalized = normalizeRecordForOutput(record.content, canonicalKey);
      if (filterFn && !filterFn(normalized, record)) continue;
      if (!unique.has(canonicalKey)) unique.set(canonicalKey, normalized);
    }
    let items = Array.from(unique.values());
    if (sortNewestFirst) items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (typeof limit === 'number') items = items.slice(0, limit);
    return items;
  } catch (e) { return []; }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
}

async function bootstrapTFIDs() {
  try {
    if (typeof loadBotStateFromMongo === 'function') await loadBotStateFromMongo();
    const records = await readAllDocsDetailed();
    await fixMissingTFIDs(records);
  } catch (e) {}
}

async function getBatchResponse(batch, limit) {
  try {
    const items = await getNormalizedUniqueItems({ sortNewestFirst: true });
    const start = (batch - 1) * limit;
    return {
      batch: batch, limit: limit, count: Math.max(0, Math.min(limit, items.length - start)),
      hasMore: start + limit < items.length, items: items.slice(start, start + limit)
    };
  } catch (e) {
    return { batch: batch, limit: limit, count: 0, hasMore: false, items: [] };
  }
}

function safeDecode(value) {
    try { return decodeURIComponent(value); } catch(e) { return value; }
}

function cleanRequestPath(reqPath) {
    return safeDecode(reqPath || '').replace(/^\/+/, '');
}

function contentTypeFromName(filename) {
    const ext = path.extname(filename).toLowerCase();
    const map = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
        '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
        '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv', '.m4v': 'video/x-m4v', '.3gp': 'video/3gpp',
        '.ts': 'video/mp2t', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4', '.pdf': 'application/pdf', '.json': 'application/json', '.txt': 'text/plain',
        '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript'
    };
    return map[ext] || 'application/octet-stream';
}

function isImageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext);
}

function isAudioFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext);
}

function isPdfFile(filename) {
    return path.extname(filename).toLowerCase() === '.pdf';
}

function isDirectVideoFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.mp4', '.webm', '.m4v'].includes(ext);
}

function needsTranscode(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.mov', '.mkv', '.avi', '.wmv', '.flv', '.3gp', '.ts', '.mpeg', '.mpg', '.m2ts'].includes(ext);
}

function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function wantsHtmlPreview(req) {
    const accept = String(req.headers.accept || '').toLowerCase();
    const dest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
    if (dest === 'video' || dest === 'audio' || dest === 'image' || dest === 'empty') return false;
    if (dest === 'document' || dest === 'iframe' || dest === 'object' || dest === 'embed') return true;
    if (accept.includes('text/html')) return true;
    return false;
}

function resolveLocalFile(requestPath) {
    const clean = requestPath.replace(/^\/+/, '');
    const filePath = path.resolve(MEDIA_DIR, clean);
    const root = path.resolve(MEDIA_DIR);
    const relative = path.relative(root, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return filePath;
}

function encodePathSegments(requestPath) {
    return requestPath.split('/').map(part => encodeURIComponent(part)).join('/');
}

function safeFileName(name) {
    const ext = path.extname(name || '');
    const base = path.basename(name || '', ext);
    const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '');
    return (safeBase + safeExt) || 'file';
}

function buildMediaUrl(requestPath, mode) {
    return "/" + encodePathSegments(requestPath) + "?" + mode + "=1";
}

function buildCustomPlayerHtml(title, targetUrl, fullUrl, mimeType) {
    const pageTitle = escapeHtml(title);
    const safeTargetUrl = escapeHtml(targetUrl);
    const safeFullUrl = escapeHtml(fullUrl);
    const safeMime = escapeHtml(mimeType || 'video/mp4');
    return "<!doctype html><html lang='ht'><head><meta charset='utf-8'/><meta name='viewport' content='width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no'/><title>" + pageTitle + "</title><meta property='og:type' content='video.other' /><meta property='og:title' content='" + pageTitle + "' /><meta property='og:description' content='Gade " + pageTitle + " sou Adam_D’H7' /><meta property='og:video' content='" + safeTargetUrl + "' /><meta property='og:video:secure_url' content='" + safeTargetUrl + "' /><meta property='og:video:type' content='" + safeMime + "' /><meta property='og:video:width' content='1280' /><meta property='og:video:height' content='720' /><meta property='og:image' content='" + ICON_URL + "' /><meta name='twitter:card' content='player' /><meta name='twitter:site' content='@adam_dh7' /><meta name='twitter:title' content='" + pageTitle + "' /><meta name='twitter:description' content='Gade " + pageTitle + " sou Adam_D’H7' /><meta name='twitter:player' content='" + safeFullUrl + "' /><meta name='twitter:player:width' content='1280' /><meta name='twitter:player:height' content='720' /><meta name='twitter:player:stream' content='" + safeTargetUrl + "' /><meta name='twitter:player:stream:content_type' content='" + safeMime + "' /><meta name='twitter:image' content='" + ICON_URL + "' /><link rel='manifest' href='manifest.json' /><meta name='theme-color' content='#000000' /><meta name='mobile-web-app-capable' content='yes' /><meta name='apple-mobile-web-app-capable' content='yes' /><meta name='apple-mobile-web-app-status-bar-style' content='black-translucent' /><meta name='apple-mobile-web-app-title' content='" + pageTitle + "' /><link rel='apple-touch-icon' href='" + ICON_URL + "' /><link rel='preload' href='" + safeTargetUrl + "' as='video' /><style>:root{ --bg:#000; --muted:#9aa0a6; --accent:#fff; --seek-height:8px; } *{box-sizing:border-box} html,body{width:100%;height:100%;margin:0;padding:0;background:var(--bg);color:var(--accent);font-family:Inter,system-ui,Arial,sans-serif;overflow:hidden;} .wrap, .video-card, .controls-wrap, .inside-mini-controls { user-select:none; -webkit-user-select:none; -ms-user-select:none; -moz-user-select:none; } .wrap{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;} .wrap.css-fullscreen { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 99999 !important; background: #000; } .video-card{position:absolute;inset:0;border-radius:0;overflow:hidden;background:#000;width:100%;height:100%;touch-action:none} video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1;background:#000;} .controls-wrap{position:absolute;left:12px;right:12px;bottom:12px;pointer-events:none;z-index:12;transition:opacity .25s ease;filter:drop-shadow(0px 2px 8px rgba(0,0,0,0.8));} .time-row{display:flex;align-items:center;gap:12px;padding:8px 12px;color:var(--muted);font-size:14px;justify-content:center} .time{width:82px;text-align:center;font-variant-numeric:tabular-nums;text-shadow:0px 2px 4px rgba(0,0,0,0.9);} .progress{flex:1;max-width:820px;display:flex;align-items:center} .seek{position:relative;height:var(--seek-height);width:100%;border-radius:999px;cursor:pointer;background:rgba(255,255,255,0.22);} .fill{position:absolute;left:0;top:0;height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg, rgba(255,255,255,0.95), rgba(255,255,255,0.55));} .thumb{position:absolute;top:50%;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:#ffffff;box-shadow:0px 1px 4px rgba(0,0,0,0.8);pointer-events:auto;touch-action:none} .controls-hidden{opacity:0;pointer-events:none} .controls-visible{opacity:1;pointer-events:auto} .inside-mini-controls{ position:absolute; left:0; right:0; top:50%; transform:translateY(-50%); z-index:13; display:flex; justify-content:space-between; align-items:center; padding:0 15%; pointer-events:none; transition:opacity .25s ease; } .inside-hidden{opacity:0;pointer-events:none} .inside-visible{opacity:1;pointer-events:auto} .inside-item{ display:flex; align-items:center; background:none; border:none; flex:1; pointer-events:auto; } #backContainer{justify-content:flex-start;} #playContainer{justify-content:center;} #forwardContainer{justify-content:flex-end;} .inside-item .mini-btn{ width:55px; height:55px; border-radius:50%; border:none; background:transparent; color:var(--accent); font-weight:700; font-size:26px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; -webkit-tap-highlight-color: transparent; filter:drop-shadow(0px 3px 6px rgba(0,0,0,0.9)); -webkit-appearance:none; appearance:none; padding:0; touch-action:manipulation; } .inside-item .mini-btn:active{transform:scale(0.85)} .landscape-btn{margin-left:8px;border:none;background:transparent;color:var(--muted);width:34px;height:34px;cursor:pointer;filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.9));display:flex;align-items:center;justify-content:center;padding:0;-webkit-appearance:none;appearance:none;touch-action:manipulation;} .landscape-btn:hover{color:var(--accent)} .landscape-btn svg {width:24px;height:24px;} .swipe-indicator-left, .swipe-indicator-right { position:absolute; top:50%; transform:translateY(-50%); color:var(--accent); display:flex; flex-direction:column; align-items:center; gap:8px; z-index:20; pointer-events:none; opacity:0; transition:opacity .15s ease; font-weight:700; font-size:16px; text-shadow:0px 2px 8px rgba(0,0,0,0.9); } .swipe-indicator-left { left: 40px; } .swipe-indicator-right { right: 40px; } .swipe-indicator-left.show, .swipe-indicator-right.show { opacity:1; } .swipe-icon{width:26px;height:26px;} .spinner-overlay { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; z-index: 15; pointer-events: none; } .spinner { animation: rotate 2s linear infinite; width: 50px; height: 50px; filter: drop-shadow(0px 2px 6px rgba(0,0,0,0.8)); } .spinner .path { stroke: var(--accent); stroke-linecap: round; animation: dash 1.5s ease-in-out infinite; } @keyframes rotate { 100% { transform: rotate(360deg); } } @keyframes dash { 0% { stroke-dasharray: 1, 150; stroke-dashoffset: 0; } 50% { stroke-dasharray: 90, 150; stroke-dashoffset: -35; } 100% { stroke-dasharray: 90, 150; stroke-dashoffset: -124; } } #errorOverlay { display: none; position: absolute; inset: 0; background: #000; z-index: 50; justify-content: center; align-items: center; flex-direction: column; } .error-container { position: relative; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; } .error-image-wrapper { position: relative; width: 100%; max-width: 100%; aspect-ratio: 16/9; display: flex; justify-content: center; align-items: center; } .error-image-wrapper img { width: 100%; height: 100%; object-fit: contain; } #errTxt { position: absolute; bottom: 5%; width: 100%; text-align: center; color: grey; font-size: clamp(12px, 2vw, 16px); z-index: 10000; font-weight: bold; text-shadow: 0 1px 2px #000; }</style></head><body><div class='wrap' id='mainWrap'><div class='video-card' id='card'><video id='video' preload='metadata' playsinline crossorigin='anonymous'><source src='" + safeTargetUrl + "' type='" + safeMime + "'></video><div id='blackOverlay' style='position:absolute;inset:0;background:rgba(0,0,0,0);z-index:2;pointer-events:none;transition:background 0.05s linear;'></div><div id='errorOverlay'><div class='error-container'><div class='error-image-wrapper'><img src='https://adamdh7.org/asset/nwa.png' alt='Erè' style='position:relative;z-index:3;' /><div id='errTxt' style='z-index:4;'></div></div></div></div><div class='spinner-overlay' id='spinnerContainer' style='display:flex;z-index:4;'><svg class='spinner' viewBox='0 0 50 50'><circle class='path' cx='25' cy='25' r='20' fill='none' stroke-width='5'></circle></svg></div><div class='inside-mini-controls inside-visible' id='insideMini'><div class='inside-item' id='backContainer'><button class='mini-btn' id='insideBack'>-10</button></div><div class='inside-item' id='playContainer'><button class='mini-btn' id='insidePlay'>❚❚</button></div><div class='inside-item' id='forwardContainer'><button class='mini-btn' id='insideForward'>+10</button></div></div><div class='controls-wrap controls-visible' id='controlsWrap'><div class='time-row' id='timeRow'><div class='time' id='current'>0:00</div><div class='progress'><div class='seek' id='seekBar' tabindex='0' role='slider' aria-valuemin='0' aria-valuemax='100' aria-valuenow='0'><div class='fill' id='fill'></div><div class='thumb' id='thumb' aria-hidden='true'></div></div></div><div class='time' id='duration'>0:00</div><button class='landscape-btn' id='landscapeBtn'></button></div></div><div class='swipe-indicator-left' id='swipeIndicatorLeft' aria-hidden='true'><div class='swipe-icon' id='swipeIconLeft'></div><div class='swipe-value' id='swipeValueLeft'>0%</div></div><div class='swipe-indicator-right' id='swipeIndicatorRight' aria-hidden='true'><div class='swipe-icon' id='swipeIconRight'></div><div class='swipe-value' id='swipeValueRight'>0%</div></div></div></div><script>(function(){const mainWrap = document.getElementById('mainWrap');const card = document.getElementById('card');const video = document.getElementById('video');const insidePlay = document.getElementById('insidePlay');const insideForward = document.getElementById('insideForward');const insideBack = document.getElementById('insideBack');const backContainer = document.getElementById('backContainer');const playContainer = document.getElementById('playContainer');const forwardContainer = document.getElementById('forwardContainer');const spinnerContainer = document.getElementById('spinnerContainer');const seekBar = document.getElementById('seekBar');const fill = document.getElementById('fill');const thumb = document.getElementById('thumb');const currentEl = document.getElementById('current');const durationEl = document.getElementById('duration');const landscapeBtn = document.getElementById('landscapeBtn');const controlsWrap = document.getElementById('controlsWrap');const insideMini = document.getElementById('insideMini');const swipeIndicatorLeft = document.getElementById('swipeIndicatorLeft');const swipeIconLeft = document.getElementById('swipeIconLeft');const swipeValueLeft = document.getElementById('swipeValueLeft');const swipeIndicatorRight = document.getElementById('swipeIndicatorRight');const swipeIconRight = document.getElementById('swipeIconRight');const swipeValueRight = document.getElementById('swipeValueRight');const errorOverlay = document.getElementById('errorOverlay');const errTxt = document.getElementById('errTxt');const blackOverlay = document.getElementById('blackOverlay');const svgBrightness = '<svg viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" width=\"26\" height=\"26\"><path d=\"M12 4V2M12 22v-2M4.93 4.93L3.51 3.51M20.49 20.49l-1.42-1.42M4 12H2M22 12h-2M4.93 19.07l-1.42 1.42M20.49 3.51l-1.42 1.42M12 8a4 4 0 100 8 4 4 0 000-8z\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>';const svgVolume = '<svg viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" width=\"26\" height=\"26\"><path d=\"M11 5L6 9H2v6h4l5 4V5z\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M19 9a5 5 0 010 6\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>';const svgFullscreenEnter = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" style=\"width:24px;height:24px;\"><path d=\"M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3\"></path></svg>';const svgFullscreenExit = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" style=\"width:24px;height:24px;\"><path d=\"M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3\"></path></svg>';const svgReplay = '<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" style=\"width:34px;height:34px;\"><path d=\"M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z\"/></svg>';landscapeBtn.innerHTML = svgFullscreenEnter;const cornerRatio = 0.25;let hideTimeout = null;let isCssFullscreen = false;let isEndedState = false;let currentBrightness = 1;function isIOSDevice() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }function formatTime(sec){sec = Math.floor(sec) || 0;const h = Math.floor(sec/3600);const m = Math.floor((sec%3600)/60);const s = sec%60;if(h>0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');return m + ':' + String(s).padStart(2,'0');}function isFullscreenCard(){ return document.fullscreenElement === card || document.webkitFullscreenElement === card || video.webkitDisplayingFullscreen || isCssFullscreen; }function isWideVideo() { return video.videoWidth > 0 && video.videoHeight > 0 && (video.videoWidth / video.videoHeight) > 1.2; }function unmuteVideo() { if (video.muted) video.muted = false; }function updateUIForTime(time) {currentEl.textContent = formatTime(time);const dur = video.duration || 1;const pct = (time / dur) * 100;fill.style.width = pct + '%';thumb.style.left = pct + '%';seekBar.setAttribute('aria-valuenow', Math.floor(time || 0));}function clearEndedState() {if (isEndedState) {isEndedState = false;forwardContainer.style.visibility = 'visible';updatePlayIcon();resetHideTimer();}}async function tryAutoplay(){try { video.muted = false; await video.play(); } catch(e){ try { video.muted = true; await video.play(); } catch(_){} }updatePlayIcon();}function updatePlayIcon(){ if (isEndedState) return;insidePlay.textContent = video.paused ? '▶︎' : '❚❚'; }async function togglePlay(){unmuteVideo();if (isEndedState) {clearEndedState();video.currentTime = 0;try { await video.play(); } catch(e){}return;}try{ if(video.paused){ try{ video.muted = false; } catch(e){} await video.play(); } else { video.pause(); } } catch(e){} updatePlayIcon(); }insidePlay.addEventListener('click', (e)=>{ e.stopPropagation(); togglePlay(); resetHideTimer(); });insideForward.addEventListener('click', (e)=>{ e.stopPropagation(); unmuteVideo(); const targetTime = Math.min(video.duration || 0, video.currentTime + 10); video.currentTime = targetTime; updateUIForTime(targetTime); resetHideTimer(); });insideBack.addEventListener('click', (e)=>{ e.stopPropagation(); unmuteVideo(); clearEndedState(); const targetTime = Math.max(0, video.currentTime - 10); video.currentTime = targetTime; updateUIForTime(targetTime); resetHideTimer(); });let scrubbing = false;let wasPlayingBeforeScrub = false;function timeFromClientX(clientX){const r = seekBar.getBoundingClientRect();let p = (clientX - r.left) / r.width;p = Math.max(0, Math.min(1, p));return (video.duration || 0) * p;}function startScrub(clientX){unmuteVideo();clearEndedState();wasPlayingBeforeScrub = !video.paused;try { video.pause(); } catch(e){}scrubbing = true;const t = timeFromClientX(clientX);video.currentTime = t;updateUIForTime(t);resetHideTimer();}function moveScrub(clientX){if(!scrubbing) return;const t = timeFromClientX(clientX);video.currentTime = t;updateUIForTime(t);resetHideTimer();}function endScrub(){if(!scrubbing) return;scrubbing = false;if(wasPlayingBeforeScrub){ try { video.play().catch(()=>{}); } catch(e){} }resetHideTimer();}seekBar.addEventListener('mousedown', (e)=>{ e.preventDefault(); e.stopPropagation(); startScrub(e.clientX); });window.addEventListener('mousemove', (e)=>{ moveScrub(e.clientX); });window.addEventListener('mouseup', (e)=>{ endScrub(); });seekBar.addEventListener('touchstart', (e)=>{ e.preventDefault(); e.stopPropagation(); startScrub(e.touches[0].clientX); }, {passive:false});window.addEventListener('touchmove', (e)=>{ if(e.touches && e.touches[0]) moveScrub(e.touches[0].clientX); }, {passive:false});window.addEventListener('touchend', (e)=>{ endScrub(); });thumb.addEventListener('pointerdown', (e)=>{ e.preventDefault(); e.stopPropagation(); startScrub(e.clientX); });window.addEventListener('pointermove', (e)=>{ if(e.pointerType) moveScrub(e.clientX); });window.addEventListener('pointerup', (e)=>{ endScrub(); });video.addEventListener('timeupdate', ()=> { if (!scrubbing) updateUIForTime(video.currentTime); });video.addEventListener('loadedmetadata', ()=> { durationEl.textContent = formatTime(video.duration || 0); seekBar.setAttribute('aria-valuemax', Math.floor(video.duration || 0)); });video.addEventListener('play', () => { clearEndedState(); updatePlayIcon(); });video.addEventListener('pause', updatePlayIcon);video.addEventListener('ended', () => {isEndedState = true;insidePlay.innerHTML = svgReplay;forwardContainer.style.visibility = 'hidden';showAll();if (hideTimeout) clearTimeout(hideTimeout);});function showAll(){ controlsWrap.classList.remove('controls-hidden'); controlsWrap.classList.add('controls-visible'); insideMini.classList.remove('inside-hidden'); insideMini.classList.add('inside-visible'); resetHideTimer(); }function hideAll(){ controlsWrap.classList.remove('controls-visible'); controlsWrap.classList.add('controls-hidden'); insideMini.classList.remove('inside-visible'); insideMini.classList.add('inside-hidden'); if(hideTimeout) clearTimeout(hideTimeout); }function toggleAll(){ const isVisible = controlsWrap.classList.contains('controls-visible') && insideMini.classList.contains('inside-visible'); if(isVisible) hideAll(); else showAll(); }function resetHideTimer() {if(hideTimeout) clearTimeout(hideTimeout);if(isEndedState) return;hideTimeout = setTimeout(() => { hideAll(); }, 4000);}function isOverControls(target){ return !!(target && (target.closest && (target.closest('.controls-wrap') || target.closest('.inside-mini-controls') || target.closest('.inside-item') || target.closest('.seek')))); }card.addEventListener('click', (e)=>{if(isOverControls(e.target)) return;hideSwipeIndicatorsDirectly();toggleAll();});window.addEventListener('mousemove', resetHideTimer);window.addEventListener('touchstart', resetHideTimer, {passive:true});[insidePlay, insideForward, insideBack, seekBar, landscapeBtn].forEach(el=>{ if(!el) return; el.addEventListener('click', e => e.stopPropagation()); });function enterLandscapeMode(){unmuteVideo();const wasPlaying = !video.paused;if (isIOSDevice() && video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); if(wasPlaying) video.play().catch(()=>{}); return; }const fsPromise = card.requestFullscreen ? card.requestFullscreen() : (card.webkitRequestFullscreen ? card.webkitRequestFullscreen() : Promise.reject(new Error(\"No FS API\")));fsPromise.then(() => {if (isWideVideo() && screen.orientation && screen.orientation.lock) { screen.orientation.lock('landscape').catch(()=>{}); }card.classList.add('landscape-mode');if(wasPlaying) video.play().catch(()=>{});showAll();}).catch((err) => {if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); } else { mainWrap.classList.add('css-fullscreen'); isCssFullscreen = true; landscapeBtn.innerHTML = svgFullscreenExit; }card.classList.add('landscape-mode');if(wasPlaying) video.play().catch(()=>{});showAll();});}function exitLandscapeMode(){const wasPlaying = !video.paused;if (isCssFullscreen) { mainWrap.classList.remove('css-fullscreen'); isCssFullscreen = false; landscapeBtn.innerHTML = svgFullscreenEnter; } else {try{if (screen.orientation && screen.orientation.unlock) { try { screen.orientation.unlock(); } catch(_) {} }if (document.exitFullscreen) document.exitFullscreen().catch(()=>{}); else if (document.webkitExitFullscreen) document.webkitExitFullscreen();}catch(err){}}card.classList.remove('landscape-mode');if(wasPlaying) video.play().catch(()=>{});showAll();}landscapeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); if(!isFullscreenCard()) enterLandscapeMode(); else exitLandscapeMode(); });document.addEventListener('fullscreenchange', ()=> {if(document.fullscreenElement === card) { card.classList.add('landscape-mode'); landscapeBtn.innerHTML = svgFullscreenExit; showAll(); } else { card.classList.remove('landscape-mode'); landscapeBtn.innerHTML = svgFullscreenEnter; isCssFullscreen = false; mainWrap.classList.remove('css-fullscreen'); showAll(); }});let gesture = null;let indicatorTimeoutLeft = null;let indicatorTimeoutRight = null;let startTouchX = 0;let startTouchY = 0;let isVerticalSwipe = false;let swipeDirectionDetermined = false;function showSwipeIndicator(kind, percent){if (kind === 'brightness') {swipeIconLeft.innerHTML = svgBrightness; swipeValueLeft.textContent = percent + '%'; swipeIndicatorLeft.classList.add('show');if(indicatorTimeoutLeft) clearTimeout(indicatorTimeoutLeft);indicatorTimeoutLeft = setTimeout(()=>{ swipeIndicatorLeft.classList.remove('show'); }, 800);} else {swipeIconRight.innerHTML = svgVolume; swipeValueRight.textContent = percent + '%'; swipeIndicatorRight.classList.add('show');if(indicatorTimeoutRight) clearTimeout(indicatorTimeoutRight);indicatorTimeoutRight = setTimeout(()=>{ swipeIndicatorRight.classList.remove('show'); }, 800);}}function hideSwipeIndicatorsDirectly() {swipeIndicatorLeft.classList.remove('show'); swipeIndicatorRight.classList.remove('show');if(indicatorTimeoutLeft) clearTimeout(indicatorTimeoutLeft);if(indicatorTimeoutRight) clearTimeout(indicatorTimeoutRight);}function clamp(v,a=0,b=1){ return Math.max(a, Math.min(b, v)); }function startLandscapeGesture(clientX, clientY){if(!isFullscreenCard()) return;unmuteVideo();const rect = card.getBoundingClientRect();const relX = clientX - rect.left;const limit = rect.width * cornerRatio;if(relX <= limit){gesture = { type:'brightness', startY:clientY, initialValue: currentBrightness };showSwipeIndicator('brightness', Math.round(gesture.initialValue * 100));} else if(relX >= (rect.width - limit)){gesture = { type:'volume', startY:clientY, initialValue: video.volume };showSwipeIndicator('volume', Math.round(gesture.initialValue * 100));} else { gesture = null; }}function moveLandscapeGesture(clientY){if(!gesture) return;const rect = card.getBoundingClientRect();const delta = (gesture.startY - clientY);const pct = delta / (rect.height * 0.7);let newVal = gesture.initialValue + pct;newVal = clamp(newVal, 0, 1);if(gesture.type === 'brightness'){const applied = Math.max(0.05, newVal);currentBrightness = applied;blackOverlay.style.background = 'rgba(0,0,0,' + (1 - applied) + ')';showSwipeIndicator('brightness', Math.round(applied * 100));} else {video.volume = newVal;showSwipeIndicator('volume', Math.round(newVal * 100));}}function endLandscapeGesture(){ if(!gesture) return; gesture = null; }card.addEventListener('touchstart', (e)=>{unmuteVideo();const t = e.touches[0];startTouchX = t.clientX; startTouchY = t.clientY;isVerticalSwipe = false; swipeDirectionDetermined = false;}, {passive:true});card.addEventListener('touchmove', (e)=>{if (!e.touches.length) return;const t = e.touches[0];const diffX = t.clientX - startTouchX;const diffY = t.clientY - startTouchY;if (!swipeDirectionDetermined) {if (Math.abs(diffY) > 10 || Math.abs(diffX) > 10) {swipeDirectionDetermined = true;if (Math.abs(diffY) > Math.abs(diffX)) { isVerticalSwipe = true; startLandscapeGesture(startTouchX, startTouchY); }}}if (isVerticalSwipe) { if (e.cancelable) e.preventDefault(); moveLandscapeGesture(t.clientY); }}, {passive:false});card.addEventListener('touchend', ()=>{ endLandscapeGesture(); }, {passive:true});function showBuffering() {if(backContainer) backContainer.style.visibility = 'hidden';if(playContainer) playContainer.style.visibility = 'hidden';if(forwardContainer) forwardContainer.style.visibility = 'hidden';spinnerContainer.style.display = 'flex';}function hideBuffering() {if(backContainer) backContainer.style.visibility = 'visible';if(playContainer) playContainer.style.visibility = 'visible';if(forwardContainer) forwardContainer.style.visibility = isEndedState ? 'hidden' : 'visible';spinnerContainer.style.display = 'none';}video.addEventListener('loadstart', showBuffering);video.addEventListener('waiting', showBuffering);video.addEventListener('seeking', showBuffering);video.addEventListener('playing', hideBuffering);video.addEventListener('seeked', hideBuffering);video.addEventListener('canplay', hideBuffering);video.addEventListener('pause', hideBuffering);if (video.readyState >= 3) { hideBuffering(); }const sourceUrl = video.querySelector('source')?.src || '';video.addEventListener('error', async (e)=>{if (blackOverlay) blackOverlay.style.background = '#000';try {const r = await fetch(sourceUrl, { method: 'HEAD', mode: 'cors' });if(!r.ok) showError('Sève an repon ' + r.status + '.'); else showError('Fòma videyo sa a pa sipòte.');} catch(fetchErr){ showError('Erè koneksyon (oubyen rezo a pa la).'); }});function showError(msg){ if(errTxt) errTxt.textContent = msg; if(errorOverlay) errorOverlay.style.display='flex'; hideBuffering();}document.addEventListener('click', unmuteVideo, {once: false});document.addEventListener('touchstart', unmuteVideo, {once: false});tryAutoplay();showAll();})();</script></body></html>";
}

function buildLightweightViewerHtml(title, mediaUrl, downloadUrl, isVideo) {
    const safeTitle = escapeHtml(title);
    const mediaBlock = isVideo ? "<video id=\"media-element\" src=\"" + mediaUrl + "\" preload=\"metadata\" autoplay controls playsinline crossorigin=\"anonymous\"></video>" : "<img id=\"media-element\" src=\"" + mediaUrl + "\" alt=\"" + safeTitle + "\">";
    return "<!doctype html><html lang=\"ht\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>" + safeTitle + "</title><link rel=\"icon\" type=\"image/png\" href=\"" + ICON_URL + "\"><link rel=\"shortcut icon\" type=\"image/png\" href=\"" + ICON_URL + "\"><link rel=\"apple-touch-icon\" href=\"" + ICON_URL + "\"><meta name=\"theme-color\" content=\"#000000\"><style>html, body { margin: 0; width: 100vw; height: 100vh; overflow: hidden; background: #000; } .wrap { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; position: relative; } img, video, audio { max-width: 100%; max-height: 100%; object-fit: contain; outline: none; } .download-btn { position: absolute; bottom: 30px; z-index: 9999; display: flex; background: rgba(255,255,255,0.2); width: 56px; height: 56px; border-radius: 50%; align-items: center; justify-content: center; color: #fff; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.3); transition: opacity 0.3s ease, transform 0.2s ease; cursor: pointer; text-decoration: none; } .download-btn:active { transform: scale(0.9); } .download-btn svg { width: 24px; height: 24px; fill: currentColor; }</style></head><body><div class=\"wrap\">" + mediaBlock + "</div><div style=\"display:flex; justify-content:center; width:100%;\"><a id=\"download-btn\" class=\"download-btn\" href=\"" + downloadUrl + "\" download=\"" + safeTitle + "\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z\"/></svg></a></div><script>function forceDownload() { window.location.href = \"" + downloadUrl + "\"; } var mediaEl = document.getElementById('media-element'); if (mediaEl) { mediaEl.addEventListener('error', forceDownload); }</script></body></html>";
}

function sendUnknown(req, res) {
    if (req.headers && req.headers.accept && req.headers.accept.includes('text/html')) {
        res.status(404).send('<!doctype html><html lang="ht"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Paj sa pa ekziste</title></head><body style="background:#000;color:#fff;text-align:center;padding:50px;font-family:sans-serif;"><h1>Paj sa pa ekziste</h1><p>Fichye ou mande a pa disponib oubyen li pa ekziste ankò.</p><script>setTimeout(function(){ window.close(); window.history.back(); }, 2500);</script></body></html>');
    } else {
        res.status(404).send('Paj sa pa ekziste');
    }
}

function serveLocalRawFile(req, res, filePath, filename, forceDownload = false) {
    try {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        let type = contentTypeFromName(filename);
        if (forceDownload) type = 'application/octet-stream';

        res.setHeader('Content-Type', type);
        res.setHeader('Accept-Ranges', 'bytes');

        const dispositionType = forceDownload ? 'attachment' : 'inline';
        res.setHeader('Content-Disposition', dispositionType + '; filename="' + escapeHtml(filename) + '"');

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (Number.isNaN(start) || Number.isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
                res.status(416).set({ 'Content-Range': 'bytes */' + fileSize });
                return res.end();
            }

            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });

            res.status(206).set({
                'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
                'Content-Length': chunksize
            });

            file.pipe(res);
            return;
        }

        res.status(200).set({ 'Content-Length': fileSize });
        fs.createReadStream(filePath).pipe(res);
    } catch (e) {
        return sendUnknown(req, res);
    }
}

async function serveRemoteRawFile(req, res, remotePath, filename, options = {}) {
    const remoteUrl = PUBLIC_BASE_URL + "/" + encodePathSegments(remotePath);
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    const fetchMethod = req.method === 'HEAD' ? 'HEAD' : 'GET';
    let upstream;
    const abortController = new AbortController();

    req.on('close', () => { abortController.abort(); });

    try {
        upstream = await fetch(remoteUrl, { 
            method: fetchMethod, 
            headers: headers, 
            redirect: 'follow',
            signal: abortController.signal
        });
    } catch (e) {
        if (e.name === 'AbortError') return;
        return sendUnknown(req, res);
    }
    
    if (!upstream.ok && upstream.status !== 206) return sendUnknown(req, res);

    const contentType = upstream.headers.get('content-type') || contentTypeFromName(filename);
    const contentLength = upstream.headers.get('content-length');
    const acceptRanges = upstream.headers.get('accept-ranges') || 'bytes';
    const contentRange = upstream.headers.get('content-range');
    const forceDownload = Boolean(options.forceDownload);
    const inlinePreferred = Boolean(options.inlinePreferred);

    res.status(upstream.status === 206 ? 206 : 200);
    
    let type = contentType;
    if (forceDownload) type = 'application/octet-stream';

    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', acceptRanges || 'bytes');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);
    
    let dispositionType = inlinePreferred ? 'inline' : 'attachment';
    if (forceDownload) dispositionType = 'attachment';
    res.setHeader('Content-Disposition', dispositionType + '; filename="' + safeFileName(filename) + '"');

    if (req.method === 'HEAD') return res.end();
    if (!upstream.body) return res.end();
    
    try {
        const bodyStream = Readable.fromWeb(upstream.body);
        bodyStream.pipe(res);
        
        bodyStream.on('error', () => {
            if (!res.headersSent) res.status(502).end();
            if (!res.writableEnded) res.end();
        });

        req.on('close', () => {
            if (bodyStream && typeof bodyStream.destroy === 'function') {
                bodyStream.destroy();
            }
        });
    } catch (e) {
        if (!res.writableEnded) res.end();
    }
}

function reqLikeCleanup(inputStream, ffmpeg, res, abort) {
    const stop = () => {
        abort();
        try { inputStream.destroy(); } catch (e) {}
        try { ffmpeg.stdin.destroy(); } catch (e) {}
    };
    res.on('close', stop);
    res.on('finish', stop);
    inputStream.on('error', stop);
}

function transcodeVideoStreamToMp4(inputStream, res) {
    if (!FFMPEG_AVAILABLE) {
        res.status(415).end();
        return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'none');

    const ffmpeg = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const abort = () => { try { ffmpeg.kill('SIGKILL'); } catch (e) {} };

    reqLikeCleanup(inputStream, ffmpeg, res, abort);

    inputStream.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    let stderr = '';
    ffmpeg.stderr.on('data', chunk => { stderr += chunk.toString(); });

    ffmpeg.on('close', code => {
        if (code !== 0 && !res.headersSent) {
            res.status(415).end();
        } else if (code !== 0 && !res.writableEnded) {
            res.end();
        }
    });

    ffmpeg.on('error', () => {
        if (!res.headersSent) res.status(502).end();
    });
}

async function serveRemoteVideoTranscode(req, res, remotePath) {
    const remoteUrl = PUBLIC_BASE_URL + "/" + encodePathSegments(remotePath);
    const controller = new AbortController();
    res.on('close', () => controller.abort());

    try {
        const upstream = await fetch(remoteUrl, { redirect: 'follow', signal: controller.signal });
        if (!upstream.ok || !upstream.body) return sendUnknown(req, res);
        const inputStream = Readable.fromWeb(upstream.body);
        transcodeVideoStreamToMp4(inputStream, res);
    } catch (e) {
        if (!res.headersSent) return sendUnknown(req, res);
        res.end();
    }
}

function serveLocalVideoTranscode(req, res, filePath) {
    const inputStream = fs.createReadStream(filePath);
    transcodeVideoStreamToMp4(inputStream, res);
}

async function resourceExists(requestPath) {
    const localPath = resolveLocalFile(requestPath);
    if (localPath && fs.existsSync(localPath) && !fs.lstatSync(localPath).isDirectory()) return true;

    const remoteUrl = PUBLIC_BASE_URL + "/" + encodePathSegments(requestPath);
    try {
        const head = await fetch(remoteUrl, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
        return head.ok;
    } catch (e) {
        return false;
    }
}

function cleanTfidRequestPath(requestPath) {
    return cleanRequestPath(requestPath || '');
}

async function findR2ObjectByPrefix(prefix) {
    try {
        const normalizedPrefix = String(prefix || '').trim();
        if (!normalizedPrefix) return null;

        const command = new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET,
            Prefix: normalizedPrefix,
            MaxKeys: 100
        });

        const result = await s3Client.send(command);
        const contents = Array.isArray(result?.Contents) ? result.Contents : [];
        if (contents.length === 0) return null;

        const files = contents
            .filter(item => item && item.Key && !String(item.Key).endsWith('/'))
            .sort((a, b) => {
                const aTime = a.LastModified ? new Date(a.LastModified).getTime() : 0;
                const bTime = b.LastModified ? new Date(b.LastModified).getTime() : 0;
                return bTime - aTime;
            });

        const picked = files[0] || contents[0];
        return picked && picked.Key ? String(picked.Key) : null;
    } catch (e) {
        return null;
    }
}

async function headR2Object(key) {
    try {
        const objectKey = String(key || '').trim();
        if (!objectKey) return null;

        const head = await s3Client.send(new HeadObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: objectKey
        }));

        return head || null;
    } catch (e) {
        return null;
    }
}

function inferMediaTypeFromKey(key, fallbackType = '') {
    try {
        const filename = path.basename(String(key || ''));
        const contentType = contentTypeFromName(filename);
        if (contentType && contentType !== 'application/octet-stream') return contentType;
        const fallback = String(fallbackType || '').trim();
        if (fallback) return fallback;
        return contentType;
    } catch (e) {
        return fallbackType || 'application/octet-stream';
    }
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setServerMeta(html, attribute, name, content) {
  const safeName = escapeRegExp(name);
  const expression = new RegExp("<meta\\b(?=[^>]*\\b" + attribute + "\\s*=\\s*['\"]" + safeName + "['\"])[^>]*>", "i");
  const tag = '<meta ' + attribute + '="' + escapeHtml(name) + '" content="' + escapeHtml(content) + '">';
  if (expression.test(html)) return html.replace(expression, tag);
  return html.replace(/<\/head>/i, tag + '\n</head>');
}

function normalizeContentLookupSlug(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return slugify(raw.replace(/^\/+|\/+$/g, ''));
}

async function resolvePostRecordForLanguage(requestedKey, requestedLanguage = '') {
  const rawKey = String(requestedKey || '').trim();
  if (!rawKey) return null;
  const wantedLanguage = normalizeLangCode(requestedLanguage);
  let sourceKey = '';
  let sourceContent = null;

  if (/^TF-\d{7}(?:\/|$)/i.test(rawKey)) {
    const direct = await findRecordByKeyAcrossModels(rawKey, {});
    if (direct && direct.doc) {
      sourceKey = direct.key;
      sourceContent = normalizeRecordForOutput(direct.doc.content || {}, direct.key);
    }
  }

  if (!sourceContent) {
    const lookupSlug = normalizeContentLookupSlug(rawKey);
    if (!lookupSlug) return null;
    const items = await getNormalizedUniqueItems({ sortNewestFirst: true });
    const matches = items.filter(item => {
      const name = extractTitle(item, item.key || item.TFID || '');
      return normalizeContentLookupSlug(name) === lookupSlug;
    });
    if (!matches.length) return null;
    matches.sort((a, b) => {
      const aLang = getKeyLanguage(a.TFID || a.key || '') || getContentLanguage(a);
      const bLang = getKeyLanguage(b.TFID || b.key || '') || getContentLanguage(b);
      const aTarget = wantedLanguage && aLang === wantedLanguage ? 1 : 0;
      const bTarget = wantedLanguage && bLang === wantedLanguage ? 1 : 0;
      if (aTarget !== bTarget) return bTarget - aTarget;
      const aSource = a._translationSourceKey ? 0 : 1;
      const bSource = b._translationSourceKey ? 0 : 1;
      if (aSource !== bSource) return bSource - aSource;
      return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    });
    sourceContent = matches[0];
    sourceKey = String(sourceContent.TFID || sourceContent.key || '').trim();
  }

  if (!sourceContent || !sourceKey) return null;

  const familyKey = getTranslationFamilyKey(sourceKey, sourceContent);
  if (wantedLanguage && familyKey) {
    const targetKey = buildTranslationVariantKey(familyKey, wantedLanguage);
    const target = await findRecordByKeyAcrossModels(targetKey, {});
    if (target && target.doc) {
      return {
        key: target.key,
        content: normalizeRecordForOutput(target.doc.content || {}, target.key),
        language: wantedLanguage
      };
    }
    if (wantedLanguage !== 'fr') {
      const sourceVariantKey = buildTranslationVariantKey(familyKey, 'fr');
      const sourceVariant = await findRecordByKeyAcrossModels(sourceVariantKey, {});
      if (sourceVariant && sourceVariant.doc) {
        return {
          key: sourceVariant.key,
          content: normalizeRecordForOutput(sourceVariant.doc.content || {}, sourceVariant.key),
          language: 'fr'
        };
      }
    }
  }

  const actualLanguage = getKeyLanguage(sourceKey) || getContentLanguage(sourceContent) || wantedLanguage || 'fr';
  return {
    key: sourceKey,
    content: normalizeRecordForOutput(sourceContent, sourceKey),
    language: actualLanguage
  };
}

function buildDynamicPostHtml(template, req, resolved) {
  if (!resolved || !resolved.content) return template;
  const content = resolved.content;
  const name = extractTitle(content, resolved.key || '');
  const bio = String(content.Bio || content.bio || '').trim();
  const rawDescription = content.Description !== undefined ? content.Description : (content.description || '');
  const description = String(rawDescription || '').trim() || 'Poste (tfposte) est une plateforme dédiée à la diffusion d’informations. Elle propose des fiches structurées regroupant titres, résumés, catégories et visuels, accessibles en plusieurs langues : Français, Anglais, Espagnol et Ht.';
  let title = name || 'Poste (tfposte)';
  const combinedTitle = bio ? title + ' ; ' + bio : title;
  if (bio && title.length <= 40 && combinedTitle.length <= 60) title = combinedTitle;

  let image = String(content['Url Thumb'] || content.urlThumb || content.thumb || content.imageUrl || '').trim();
  try {
    const parsedImage = new URL(image, BASE_URL);
    if (parsedImage.protocol !== 'https:' && parsedImage.protocol !== 'http:') image = '';
    else image = parsedImage.href;
  } catch (e) {
    image = '';
  }
  if (!image) image = 'https://adamdh7.org/adamdh7.png';

  const requestUrl = new URL('/', String(BASE_URL || 'https://poste.adamdh7.org').replace(/\/+$/, '') + '/');
  requestUrl.searchParams.set('key', String(req.query.key || ''));
  const pageLanguage = normalizeLangCode(resolved.language) || normalizeLangCode(req.query.lang) || 'fr';
  if (pageLanguage) requestUrl.searchParams.set('lang', pageLanguage);
  const pageUrl = requestUrl.toString();
  const localeMap = { fr: 'fr_FR', en: 'en_US', es: 'es_ES', ht: 'ht_HT' };
  const plainDescription = description.replace(/\r\n?/g, '\n').replace(/```[\s\S]*?```/g, ' ').replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[*_~`>#]/g, ' ').replace(/\s+/g, ' ').trim();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: name || title,
    description: plainDescription || description,
    image: [image],
    url: pageUrl,
    mainEntityOfPage: pageUrl,
    inLanguage: pageLanguage
  };
  const updatedAt = Number(content.updatedAt || 0);
  if (Number.isFinite(updatedAt) && updatedAt > 0) jsonLd.dateModified = new Date(updatedAt).toISOString();

  let html = template;
  html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '<title>' + escapeHtml(title) + '</title>');
  html = setServerMeta(html, 'name', 'description', description);
  html = setServerMeta(html, 'property', 'og:title', title);
  html = setServerMeta(html, 'property', 'og:description', description);
  html = setServerMeta(html, 'property', 'og:url', pageUrl);
  html = setServerMeta(html, 'property', 'og:type', 'article');
  html = setServerMeta(html, 'property', 'og:image', image);
  html = setServerMeta(html, 'property', 'og:image:secure_url', image);
  const imageMimeType = contentTypeFromName(new URL(image).pathname);
  if (imageMimeType && imageMimeType !== 'application/octet-stream') html = setServerMeta(html, 'property', 'og:image:type', imageMimeType);
  html = setServerMeta(html, 'property', 'og:image:alt', title);
  html = setServerMeta(html, 'property', 'og:site_name', 'Poste');
  html = setServerMeta(html, 'property', 'og:locale', localeMap[pageLanguage] || 'fr_FR');
  html = setServerMeta(html, 'name', 'twitter:title', title);
  html = setServerMeta(html, 'name', 'twitter:description', description);
  html = setServerMeta(html, 'name', 'twitter:image', image);
  html = setServerMeta(html, 'name', 'twitter:image:alt', title);
  html = setServerMeta(html, 'name', 'twitter:card', 'summary_large_image');
  html = html.replace(/<link\b(?=[^>]*\brel\s*=\s*['"](?:icon|shortcut icon|apple-touch-icon|image_src|canonical)['"])[^>]*>/gi, '');
  html = html.replace(/<meta\b(?=[^>]*\bproperty\s*=\s*['"]og:image:(?:width|height)['"])[^>]*>/gi, '');
  const links = [
    '<link rel="icon" href="' + escapeHtml(image) + '">',
    '<link rel="shortcut icon" href="' + escapeHtml(image) + '">',
    '<link rel="apple-touch-icon" href="' + escapeHtml(image) + '">',
    '<link rel="image_src" href="' + escapeHtml(image) + '">',
    '<link rel="canonical" href="' + escapeHtml(pageUrl) + '">'
  ].join('\n');
  html = html.replace(/<\/head>/i, links + '\n</head>');
  html = html.replace(/<script\b[^>]*id\s*=\s*['"]dynamic-post-jsonld['"][^>]*>[\s\S]*?<\/script>/i, '');
  const articleJsonLd = '<script id="dynamic-post-jsonld" type="application/ld+json">' + JSON.stringify(jsonLd).replace(/</g, '\\u003c') + '</script>';
  const pagePayload = '<script>window.__POSTE_SERVER_PAGE=' + JSON.stringify({
    key: resolved.key,
    requestKey: String(req.query.key || ''),
    language: resolved.language || pageLanguage,
    content: content
  }).replace(/</g, '\\u003c') + ';</script>';
  html = html.replace(/<\/head>/i, articleJsonLd + '\n' + pagePayload + '\n</head>');
  html = html.replace(/<html\b([^>]*)>/i, (whole, attrs) => {
    if (/\blang\s*=/.test(attrs)) return '<html' + attrs.replace(/\blang\s*=\s*(['"])[^'"]*\1/i, 'lang="' + escapeHtml(pageLanguage) + '">');
    return '<html' + attrs + ' lang="' + escapeHtml(pageLanguage) + '">';
  });
  return html;
}

app.get('/', async (req, res) => {
  try {
    const rootIndexPath = path.join(process.cwd(), 'index.html');
    const publicIndexPath = path.join(process.cwd(), 'public', 'index.html');
    const indexPath = fs.existsSync(rootIndexPath) ? rootIndexPath : publicIndexPath;
    if (!fs.existsSync(indexPath)) return res.status(404).end();
    let html = await fs.promises.readFile(indexPath, 'utf8');
    const requestedKey = String(req.query.key || '').trim();
    if (requestedKey) {
      const resolved = await resolvePostRecordForLanguage(requestedKey, req.query.lang || '');
      if (resolved) html = buildDynamicPostHtml(html, req, resolved);
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', requestedKey ? 'private, no-store, no-cache, must-revalidate' : 'no-cache');
    res.set('Vary', 'Accept-Language');
    return res.status(200).send(html);
  } catch (e) {
    try {
      const fallbackPath = path.join(process.cwd(), 'public', 'index.html');
      if (fs.existsSync(fallbackPath)) return res.status(200).sendFile(fallbackPath);
    } catch (ignored) {}
    return res.status(502).end();
  }
});

app.get('/sitemap.xml', (req, res) => {
  try {
    const indexPath = path.join(process.cwd(), 'sitemap.xml');
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.status(404).end();
  } catch (e) {
    res.status(502).end();
  }
});

app.get(['/adamdh7=modpas/adamdh7', '/adamdh7=modpas/adamdh7/*'], (req, res) => {
  try {
    const indexPath = path.join(process.cwd(), 'index.html');
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.status(404).end();
  } catch (e) {
    res.status(502).end();
  }
});

app.get('/favicon.ico', (req, res) => res.redirect(301, BASE_URL + '/poste2.png'));
app.get('/poste2.png', (req, res) => res.sendFile(path.join(process.cwd(), 'poste2.png')));

function buildR2PublicUrl(key) {
  try {
    const base = String(PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    const parsed = new URL(base);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return base + '/' + encodePathSegments(String(key || '').replace(/^\/+/, ''));
  } catch (e) {
    return '';
  }
}

app.get('/TF-:id(*)', async (req, res) => {
  try {
    const requestedPath = cleanTfidRequestPath(req.path || '');
    const match = requestedPath.match(/^(TF-\d{7})(?:\/(.*))?$/i);
    if (!match) return sendUnknown(req, res);
    const tfid = match[1];
    const requestedObjectPath = String(match[2] || '').trim();
    let objectKey = '';
    if (requestedObjectPath) {
      const exactKey = tfid + '/' + requestedObjectPath;
      const exactObject = await headR2Object(exactKey);
      if (exactObject) objectKey = exactKey;
    } else {
      objectKey = await findR2ObjectByPrefix(tfid + '/') || '';
    }
    if (!objectKey) return sendUnknown(req, res);
    const directUrl = buildR2PublicUrl(objectKey);
    if (!directUrl) return res.status(503).json({ error: 'PUBLIC_BASE_URL must point to the public R2 bucket URL' });
    return res.redirect(302, directUrl);
  } catch (e) {
    return res.status(502).end();
  }
});


app.put('/upload', async (req, res) => {
  try {
    const filename = String(req.query.filename || '').trim();
    if (!filename) return res.status(400).json({ error: 'Fichye a pa gen non' });
    const contentLengthHeader = req.headers['content-length'];
    if (!contentLengthHeader) return res.status(411).json({ error: 'Ou dwe mete gwosè fichye a nan header a' });
    const contentLength = parseInt(contentLengthHeader, 10);
    if (Number.isNaN(contentLength) || contentLength <= 0) return res.status(400).json({ error: 'Gwosè fichye a pa valab' });
    if (contentLength > maxSizeBytes) return res.status(413).json({ error: 'Fichye a twò gwo' });

    const parsed = path.parse(filename);
    let baseName = parsed.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_');
    if (!baseName || baseName === '.') baseName = 'fichye';
    const safeFilename = baseName + parsed.ext.toLowerCase();
    const idempotencyKey = String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.query.idempotencyKey || '').trim();
    let tfid = "TF-" + randomDigits(7);
    let key = tfid + "/" + safeFilename;

    if (idempotencyKey) {
      const idempotencyDigest = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
      const stableNumber = String(parseInt(idempotencyDigest.slice(0, 8), 16) % 10000000).padStart(7, '0');
      tfid = 'TF-' + stableNumber;
      key = tfid + '/' + idempotencyDigest.slice(8, 24) + '-' + safeFilename;
      const existingUpload = await headR2Object(key);
      if (existingUpload) {
        req.resume();
        return res.json({ key: key, url: buildPublicUrl(key), metadata: existingUpload.Metadata || {}, contentType: existingUpload.ContentType || contentTypeFromName(key), duplicate: true });
      }
    }

    const headerContentType = String(req.headers['content-type'] || '').trim();
    const inferredContentType = inferMediaTypeFromKey(key, '');
    const contentType = (!headerContentType || headerContentType === 'application/octet-stream' || headerContentType.startsWith('multipart/form-data'))
      ? inferredContentType
      : headerContentType;

    const metadata = {
      tfid: tfid,
      originalname: String(filename).slice(0, 250),
      filename: safeFilename.slice(0, 250),
      contenttype: String(contentType).slice(0, 250)
    };

    let receivedBytes = 0;
    const meterStream = new PassThrough();
    meterStream.on('data', chunk => {
      try {
        receivedBytes += chunk.length;
        if (receivedBytes > maxSizeBytes) meterStream.destroy(new Error('Fichye a twò gwo'));
      } catch (e) {}
    });

    req.pipe(meterStream);
    req.on('aborted', () => { try { meterStream.destroy(); } catch (e) {} });

    try {
      const parallelUpload = new Upload({
        client: s3Client,
        params: {
          Bucket: process.env.R2_BUCKET,
          Key: key,
          Body: meterStream,
          ContentType: contentType,
          ContentDisposition: 'inline; filename="' + safeFilename.replace(/"/g, '\"') + '"',
          Metadata: metadata
        },
        partSize: 10 * 1024 * 1024,
        queueSize: 4
      });
      await parallelUpload.done();
      return res.json({ key: key, url: buildPublicUrl(key), metadata: metadata, contentType: contentType });
    } catch (err) {
      const isTooLarge = err.message === 'Fichye a twò gwo' || (err.$metadata && err.$metadata.httpStatusCode === 413);
      if (isTooLarge) return res.status(413).end();
      return res.status(502).end();
    }
  } catch (e) {
    return res.status(502).end();
  }
});


app.get('/ok', (req, res) => res.json({ ok: true }));

app.get('/data', async (req, res) => {
  try {
    const items = await getNormalizedUniqueItems({ sortNewestFirst: true });
    res.json({ items: items });
  } catch (err) { res.status(502).end(); }
});

app.get('/cherche', async (req, res) => {
  try {
    const q = String(req.query.name || req.query.q || req.query.query || '').toLowerCase().trim();
    if (!q) return res.json([]);

    const items = await getNormalizedUniqueItems({ sortNewestFirst: false });
    const scored = items
      .map(item => {
        try {
          const fullText = contentTextBlob(item).toLowerCase();
          let score = 0;
          score += textScore(q, item.Name || item.Titre || item.title || item.name, 8);
          score += textScore(q, item.TFID || item.key, 7);
          score += textScore(q, item.Description, 5);
          score += textScore(q, item.Bio, 4);
          score += textScore(q, item['Catégorie'] || item.Catégorie || item.category, 3);
          score += textScore(q, item.slug, 3);
          score += textScore(q, item['Url Thumb'] || item.thumb, 1);
          score += textScore(q, item['Url Video'] || item.videoUrl, 1);
          if (fullText.includes(q)) score += 20;
          return { item: item, score: score };
        } catch (e) { return { item: item, score: 0 }; }
      })
      .filter(entry => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.item.updatedAt || 0) - (a.item.updatedAt || 0);
      }).slice(0, 100).map(entry => entry.item);
    res.json(scored);
  } catch (err) { res.status(502).end(); }
});

app.post('/sync/receive', async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).json({ success: false, error: 'items must be an array' });
    let count = 0;
    const translationSources = [];
    for (const item of items) {
      if (!item || !item.key || !item.content || typeof item.content !== 'object') continue;
      const rawKey = String(item.key).trim();
      const existing = await findRecordByKeyAcrossModels(rawKey, item.content);
      const canonicalKey = existing && existing.key ? existing.key : buildCanonicalKey(rawKey, item.content);
      const normalized = normalizeRecordForOutput(item.content, canonicalKey);
      const incomingTimestamp = Number(normalized.updatedAt || 0);
      if (existing && existing.doc) {
        const currentContent = existing.doc.content || {};
        const currentTimestamp = Number(currentContent.updatedAt || 0);
        if (incomingTimestamp && currentTimestamp && incomingTimestamp < currentTimestamp) continue;
        const next = Object.assign({}, currentContent, normalized);
        next.TFID = canonicalKey;
        next.key = canonicalKey;
        const updateResult = await existing.model.updateOne({ key: canonicalKey }, { $set: { content: next } });
        if (updateResult.matchedCount > 0) {
          count++;
          translationSources.push({ key: canonicalKey, content: next, modelIndex: existing.modelIndex });
        }
      } else {
        let saved = false;
        let savedModelIndex = 0;
        for (let i = 0; i < models.length; i++) {
          try {
            await models[i].create({ key: canonicalKey, content: normalized });
            saved = true;
            savedModelIndex = i;
            break;
          } catch (e) {
            if (e && e.code === 11000) {
              const found = await findRecordByKeyAcrossModels(canonicalKey, normalized);
              if (found && found.doc) {
                saved = true;
                savedModelIndex = found.modelIndex;
                break;
              }
            }
          }
        }
        if (saved) {
          count++;
          translationSources.push({ key: canonicalKey, content: normalized, modelIndex: savedModelIndex });
        }
      }
    }
    for (const source of translationSources) await enqueueTranslationJobsForContent(source.key, source.content, { modelIndex: source.modelIndex });
    res.json({ success: true, received: count });
    if (translationSources.length) setImmediate(() => processTranslationQueue({ reason: 'sync-receive' }).catch(() => {}));
  } catch (err) {
    res.status(502).end();
  }
});


const contentCreationLocks = new Map();

function normalizeFingerprintText(value) {
  return String(value === undefined || value === null ? '' : value).trim().replace(/\s+/g, ' ');
}

function createContentFingerprint(category, language, name, thumb, bio, description, urlVideo) {
  const payload = {
    category: normalizeFingerprintText(category).toLowerCase(),
    language: normalizeLangCode(language),
    name: normalizeFingerprintText(name),
    thumb: normalizeFingerprintText(thumb),
    bio: normalizeFingerprintText(bio),
    description: normalizeFingerprintText(description),
    urlVideo: normalizeFingerprintText(urlVideo)
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function createContentOnce(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'Invalid item' };
  const category = item['Catégorie'] || item.category || item.Catégorie;
  const name = item.Name || item.name || item.Titre || item.title;
  if (category === undefined || name === undefined || !String(category).trim() || !String(name).trim()) return { ok: false, error: 'Catégorie et nom obligatoires' };
  const thumb = item['Url Thumb'] !== undefined ? String(item['Url Thumb']).trim() : String(item.thumb || '').trim();
  const bio = item.Bio !== undefined ? String(item.Bio).trim() : String(item.bio || '').trim();
  const description = item.Description !== undefined ? String(item.Description).trim() : String(item.description || '').trim();
  const urlVideo = item['Url Video'] !== undefined ? String(item['Url Video']).trim() : String(item.videoUrl || '').trim();
  const extracted = extractCategoryAndLang(category);
  const categoryBase = slugify(extracted.cat) || 'inconnu';
  const baseSlug = slugify(name) || 'untitled';
  const initialLang = normalizeLangCode(extracted.lang || category);
  const fingerprint = createContentFingerprint(categoryBase, initialLang, name, thumb, bio, description, urlVideo);
  const existing = await findRecordByFingerprint(fingerprint);
  if (existing && existing.doc) {
    return {
      ok: true,
      duplicate: true,
      key: existing.key,
      content: normalizeRecordForOutput(existing.doc.content || {}, existing.key),
      modelIndex: existing.modelIndex
    };
  }
  if (contentCreationLocks.has(fingerprint)) return contentCreationLocks.get(fingerprint);
  const operation = (async () => {
    const secondCheck = await findRecordByFingerprint(fingerprint);
    if (secondCheck && secondCheck.doc) {
      return {
        ok: true,
        duplicate: true,
        key: secondCheck.key,
        content: normalizeRecordForOutput(secondCheck.doc.content || {}, secondCheck.key),
        modelIndex: secondCheck.modelIndex
      };
    }
    if (!models.length) return { ok: false, error: 'Database unavailable' };
    let key = '';
    let content = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const tfid = 'TF-' + randomDigits(7);
      key = tfid + '/' + categoryBase + '/' + baseSlug + (initialLang ? '/' + initialLang : '');
      let keyExists = false;
      for (const model of models) {
        try {
          if (await model.exists({ key: key })) {
            keyExists = true;
            break;
          }
        } catch (e) {}
      }
      if (keyExists) continue;
      content = normalizeRecordForOutput({
        'Url Thumb': thumb,
        'Catégorie': category,
        Name: String(name).trim(),
        Bio: bio,
        Description: description,
        'Url Video': urlVideo,
        updatedAt: Date.now()
      }, key);
      for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
        try {
          await models[modelIndex].create({ key: key, requestFingerprint: fingerprint, content: content });
          return { ok: true, duplicate: false, key: key, content: content, modelIndex: modelIndex };
        } catch (e) {
          if (e && e.code === 11000) {
            const found = await findRecordByFingerprint(fingerprint);
            if (found && found.doc) {
              return {
                ok: true,
                duplicate: true,
                key: found.key,
                content: normalizeRecordForOutput(found.doc.content || {}, found.key),
                modelIndex: found.modelIndex
              };
            }
          }
        }
      }
    }
    return { ok: false, error: 'Could not persist content' };
  })();
  contentCreationLocks.set(fingerprint, operation);
  try {
    return await operation;
  } finally {
    if (contentCreationLocks.get(fingerprint) === operation) contentCreationLocks.delete(fingerprint);
  }
}

function comparableContent(content) {
  const copy = Object.assign({}, content || {});
  delete copy.updatedAt;
  return JSON.stringify(Object.keys(copy).sort().reduce((result, key) => {
    result[key] = copy[key];
    return result;
  }, {}));
}

app.post('/data', async (req, res) => {
  try {
    if (!req.body) return res.status(400).json({ success: false, error: 'Content required' });
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];
    const resultKeys = new Set();
    const translationSources = [];
    for (const item of items) {
      const result = await createContentOnce(item);
      if (!result.ok || resultKeys.has(result.key)) continue;
      resultKeys.add(result.key);
      results.push({ key: result.key, TFID: result.content.TFID || result.key, content: result.content, duplicate: result.duplicate === true });
      translationSources.push({ key: result.key, content: result.content, modelIndex: result.modelIndex });
    }
    if (!results.length) return res.status(400).json({ success: false, count: 0, items: [], error: 'No valid content was created' });
    for (const source of translationSources) {
      await enqueueTranslationJobsForContent(source.key, source.content, { modelIndex: source.modelIndex });
    }
    res.status(results.some(item => !item.duplicate) ? 201 : 200).json({ success: true, count: results.length, items: results });
    if (translationSources.length) setImmediate(() => processTranslationQueue({ reason: 'post-create' }).catch(() => {}));
  } catch (err) {
    res.status(502).end();
  }
});

app.put('/data', async (req, res) => {
  try {
    const body = req.body || {};
    const keyInput = String(body.key || '').trim();
    const incomingContent = body.content;
    if (!keyInput || !incomingContent || typeof incomingContent !== 'object' || Array.isArray(incomingContent)) {
      return res.status(400).json({ success: false, error: 'Valid key and content are required' });
    }
    const found = await findRecordByKeyAcrossModels(keyInput, incomingContent);
    if (!found || !found.doc) return res.status(404).json({ success: false, error: 'Content not found' });
    const canonicalKey = found.key;
    const existingContent = found.doc.content || {};
    const currentUpdatedAt = Number(existingContent.updatedAt || 0);
    const submittedUpdatedAt = Number(incomingContent.updatedAt || 0);
    const normalizedIncoming = Object.assign({}, incomingContent);
    const aliases = [['Name', 'name'], ['Catégorie', 'category'], ['Bio', 'bio'], ['Description', 'description'], ['Url Thumb', 'thumb'], ['Url Video', 'videoUrl']];
    for (const pair of aliases) {
      if (!Object.prototype.hasOwnProperty.call(normalizedIncoming, pair[0]) && Object.prototype.hasOwnProperty.call(normalizedIncoming, pair[1])) {
        normalizedIncoming[pair[0]] = normalizedIncoming[pair[1]];
      }
    }
    const mergedContent = Object.assign({}, existingContent, normalizedIncoming);
    mergedContent.key = canonicalKey;
    mergedContent.TFID = canonicalKey;
    const identityLanguage = getKeyLanguage(canonicalKey) || getContentLanguage(existingContent);
    if (identityLanguage) {
      let currentCategory = existingContent['Catégorie'] || existingContent.category || existingContent.Catégorie || '';
      if (Object.prototype.hasOwnProperty.call(normalizedIncoming, 'Catégorie')) currentCategory = normalizedIncoming['Catégorie'];
      else if (Object.prototype.hasOwnProperty.call(normalizedIncoming, 'category')) currentCategory = normalizedIncoming.category;
      const categoryBase = splitCategoryLanguage(currentCategory).cat || String(currentCategory || '').trim();
      mergedContent['Catégorie'] = buildCanonicalCategory(categoryBase, identityLanguage);
      mergedContent.category = mergedContent['Catégorie'];
    }
    let normalized = normalizeRecordForOutput(mergedContent, canonicalKey);
    normalized.key = canonicalKey;
    normalized.TFID = canonicalKey;
    if (comparableContent(normalized) === comparableContent(existingContent)) {
      await enqueueTranslationJobsForContent(canonicalKey, existingContent, { modelIndex: found.modelIndex });
      res.json({ success: true, unchanged: true, key: canonicalKey, content: normalizeRecordForOutput(existingContent, canonicalKey) });
      setImmediate(() => processTranslationQueue({ reason: 'unchanged-update' }).catch(() => {}));
      return;
    }
    if (currentUpdatedAt && submittedUpdatedAt && submittedUpdatedAt < currentUpdatedAt) {
      return res.status(409).json({ success: false, error: 'Stale update rejected', key: canonicalKey, content: normalizeRecordForOutput(existingContent, canonicalKey) });
    }
    if (existingContent._translationSourceKey) {
      delete normalized._translationSourceKey;
      delete normalized._translationSourceUpdatedAt;
      delete normalized._translationTargetLang;
      delete normalized._translationGeneratedAt;
    }
    normalized.updatedAt = Math.max(Date.now(), currentUpdatedAt + 1);
    const filter = { key: canonicalKey };
    if (Object.prototype.hasOwnProperty.call(existingContent, 'updatedAt')) filter['content.updatedAt'] = existingContent.updatedAt;
    else filter['content.updatedAt'] = { $exists: false };
    const updateResult = await found.model.updateOne(filter, { $set: { content: normalized } });
    if (!updateResult || updateResult.matchedCount === 0) {
      const latest = await findRecordByKeyAcrossModels(canonicalKey, {});
      return res.status(409).json({ success: false, error: 'Content changed concurrently', key: canonicalKey, content: latest && latest.doc ? normalizeRecordForOutput(latest.doc.content || {}, latest.key) : null });
    }
    await enqueueTranslationJobsForContent(canonicalKey, normalized, { modelIndex: found.modelIndex });
    res.json({ success: true, key: canonicalKey, content: normalized });
    setImmediate(() => processTranslationQueue({ reason: 'post-update' }).catch(() => {}));
  } catch (err) {
    res.status(502).end();
  }
});

app.delete('/data', async (req, res) => {
  try {
    const keyInput = String((req.body || {}).key || '').trim();
    if (!keyInput) return res.status(400).json({ success: false, error: 'Key required' });
    await loadTranslationQueueFromDisk();
    const found = await findRecordByKeyAcrossModels(keyInput, {});
    const actualKey = found && found.key ? found.key : keyInput;
    let deleted = false;
    for (const model of models) {
      try {
        const result = await model.deleteOne({ key: actualKey });
        if (result && result.deletedCount > 0) deleted = true;
      } catch (e) {}
    }
    let queueChanged = false;
    for (const [jobId, job] of translationQueueCache.entries()) {
      if (job.sourceKey === actualKey || job.targetKey === actualKey) {
        translationQueueCache.delete(jobId);
        queueChanged = true;
      }
    }
    if (queueChanged) await flushTranslationQueue();
    res.json({ success: true, key: actualKey, deleted: deleted, alreadyDeleted: !deleted });
  } catch (err) {
    res.status(502).end();
  }
});



app.get('/resolve', async (req, res) => {
  try {
    const requestedKey = String(req.query.key || '').trim();
    const requestedLanguage = normalizeLangCode(req.query.lang || '');
    if (!requestedKey) return res.status(400).json({ success: false, error: 'Key required' });
    const resolved = await resolvePostRecordForLanguage(requestedKey, requestedLanguage);
    if (!resolved) return res.status(404).json({ success: false, error: 'Content not found' });
    res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    return res.json({
      success: true,
      key: resolved.key,
      language: resolved.language,
      requestedLanguage: requestedLanguage || null,
      content: resolved.content
    });
  } catch (e) {
    return res.status(502).json({ success: false, error: 'Content resolution failed' });
  }
});

app.get('/data/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    let result = null;
    let resultKey = key;
    for (const m of models) {
      try {
        const found = await findRecordByKey(m, key);
        if (found && found.doc) {
          resultKey = found.key;
          result = normalizeRecordForOutput(found.doc.content || {}, found.key);
          break;
        }
      } catch (e) {}
    }
    if (!result) return res.status(404).end();
    res.json({ key: resultKey, content: result });
  } catch (err) { res.status(502).end(); }
});

app.get('/get-all', async (req, res) => {
  try {
    const items = await getNormalizedUniqueItems({ sortNewestFirst: true });
    res.json(items);
  } catch (err) { res.status(502).end(); }
});

app.get('/get-post', async (req, res) => {
  try {
    const items = await getNormalizedUniqueItems({
      sortNewestFirst: true, filterFn: item => String(splitCategoryLanguage(item["Catégorie"] || item.category || '').cat || '').trim().toLowerCase() === 'poste'
    });
    res.json(items);
  } catch (err) { res.status(502).end(); }
});

app.get(['/get-fr', '/get/fr', '/get-es', '/get/es', '/get-ht', '/get/ht', '/get-en', '/get/en'], async (req, res) => {
  try {
    const rawLang = req.path.split('/').pop();
    const lang = normalizeLangCode(rawLang.replace('get-', '').toLowerCase());
    if (!lang) return res.json([]);

    const items = await getNormalizedUniqueItems({
      sortNewestFirst: true,
      filterFn: item => {
        const itemLang = getKeyLanguage(item.TFID || item.key || '') || getContentLanguage(item);
        return itemLang === lang;
      }
    });

    const formattedItems = items.map(item => {
      const catStr = String(item["Catégorie"] || item.category || '');
      const finalCat = buildCanonicalCategory(catStr, lang);

      return {
        "Url Thumb": item["Url Thumb"] !== undefined ? String(item["Url Thumb"]) : (item.thumb || ""),
        "Catégorie": finalCat,
        "Name": item["Name"] !== undefined ? String(item["Name"]) : (item.title || item.Titre || ""),
        "Bio": item["Bio"] !== undefined ? String(item["Bio"]) : (item.bio || ""),
        "Description": item["Description"] !== undefined ? String(item["Description"]) : (item.description || ""),
        "Url Video": item["Url Video"] !== undefined ? String(item["Url Video"]) : (item.videoUrl || "")
      };
    });

    shuffleArray(formattedItems);
    res.json(formattedItems);
  } catch (err) { res.status(502).end(); }
});

app.get(['/get/:batch(\\d+)', '/get-batch/:batch(\\d+)'], async (req, res) => {
  try {
    const batch = parseInt(req.params.batch, 10);
    const limit = parseInt(req.query.limit, 10) || 100;
    if (Number.isNaN(batch) || batch < 1) return res.status(502).end();
    res.json(await getBatchResponse(batch, limit));
  } catch (err) { res.status(502).end(); }
});

app.post('/user/resan', async (req, res) => {
  try {
    const { userTfid, contentTfid, timePlayed, totalTime } = req.body;
    if (!userTfid || !contentTfid) return res.status(400).json({ error: 'userTfid ak contentTfid obligatwa' });
    
    const userData = await syncGetUser(userTfid);
    let resanList = userData.resan || [];
    let existingIndex = resanList.findIndex(r => r.contentTfid === contentTfid);
    const now = Date.now();
    
    if (existingIndex >= 0) {
      resanList[existingIndex].timePlayed = timePlayed;
      resanList[existingIndex].totalTime = totalTime;
      resanList[existingIndex].updatedAt = now;
    } else resanList.push({ contentTfid: contentTfid, timePlayed: timePlayed, totalTime: totalTime, updatedAt: now });
    
    resanList.sort((a, b) => b.updatedAt - a.updatedAt);
    const result = await syncUpdateUser(userTfid, { resan: resanList });
    res.json({ success: true, synced: result.syncedToMongo });
  } catch (err) { res.status(502).end(); }
});

app.delete('/user/resan', async (req, res) => {
  try {
    const { userTfid, contentTfids } = req.body;
    if (!userTfid || !contentTfids) return res.status(400).json({ error: 'userTfid ak contentTfids obligatwa' });
    const toRemove = Array.isArray(contentTfids) ? contentTfids : [contentTfids];
    
    const userData = await syncGetUser(userTfid);
    let resanList = (userData.resan || []).filter(r => !toRemove.includes(r.contentTfid));
    const result = await syncUpdateUser(userTfid, { resan: resanList });
    res.json({ success: true, synced: result.syncedToMongo });
  } catch (err) { res.status(502).end(); }
});

app.post('/user/pwen', async (req, res) => {
  try {
    const { userTfid, amount } = req.body;
    if (!userTfid || amount === undefined) return res.status(400).json({ error: 'userTfid ak amount obligatwa' });
    const numAmount = parseInt(amount, 10);
    if (Number.isNaN(numAmount)) return res.status(400).json({ error: 'Kantite pwen pa valab' });
    if (numAmount > 1) return res.status(400).json({ error: 'Ou ka sèlman ajoute 1 pwen pa fwa' });

    const userData = await syncGetUser(userTfid);
    const now = Date.now();
    let newPwen = userData.pwen;
    let lastAdd = userData.lastPwenAdd;

    if (numAmount === 1) {
      if (now - userData.lastPwenAdd < 2000) return res.status(429).json({ error: 'Ou dwe tann 2 segonn' });
      newPwen += 1;
      lastAdd = now;
    } else if (numAmount < 0) {
      newPwen += numAmount;
      if (newPwen < 0) newPwen = 0;
    } else return res.json({ success: true, pwen: userData.pwen });

    const result = await syncUpdateUser(userTfid, { pwen: newPwen, lastPwenAdd: lastAdd });
    res.json({ success: true, pwen: result.user.pwen, synced: result.syncedToMongo });
  } catch (err) { res.status(502).end(); }
});

app.get('/user/:tfid', async (req, res) => {
  try {
    const userData = await syncGetUser(req.params.tfid);
    res.json({ tfid: userData.tfid, pwen: userData.pwen, resan: userData.resan });
  } catch (err) { res.status(502).end(); }
});

app.use((err, req, res, next) => {
  try { res.status(502).end(); } catch (e) {}
});

bootstrapTFIDs().then(() => autoTranslateDocs()).catch(() => {});
sendTg("getMe", {}).then(r => { if (r && r.ok && r.result) BOT_USERNAME = r.result.username; }).catch(() => {});

app.listen(PORT, '0.0.0.0', () => {
  console.log("Serveur unifié démarré et à l'écoute sur le port " + PORT);
});

setTimeout(function translationLoop() {
    autoTranslateDocs().catch(() => {});
    setTimeout(translationLoop, 17 * 60 * 60 * 1000);
}, 17 * 60 * 60 * 1000);

async function sendPromoMessage() {
    try {
        await loadBotStateFromMongo();
        const users = Object.keys(usersLang);
        for (let i = 0; i < users.length; i++) {
            const chatId = users[i];
            const text = pickT(chatId, "promo_msg");
            const btnText = pickT(chatId, "promo_btn");
            const kb = [[{ text: btnText, url: "https://t.me/dh7adam" }]];
            await sendTg("sendPhoto", {
                chat_id: chatId,
                photo: defaultImage,
                caption: text,
                reply_markup: { inline_keyboard: kb }
            });
            await new Promise(r => setTimeout(r, 60));
        }
    } catch (e) {}
}

setTimeout(function promoLoop() {
    sendPromoMessage();
    setTimeout(promoLoop, 17 * 60 * 60 * 1000);
}, 60 * 1000);
