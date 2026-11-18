from pathlib import Path
from html import escape

ROOT = Path(__file__).parent
C = dict(bg='#F4F6F1', white='#FFFFFF', ink='#19372E', sub='#526A61', mute='#778A80',
         line='#DAE3DB', green='#17533F', pale='#EAF2E8', lime='#D8E9C8', blue='#EAF2F9',
         blueink='#355F80', amber='#FFF2D8', amberink='#80581E', subtle='#F8FAF6')
FONT = 'Noto Sans CJK SC, sans-serif'

class Board:
    def __init__(self, name, w, h, title, desc):
        self.name, self.w, self.h = name,w,h
        self.s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">',
                  f'<title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc>',
                  '<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#8CA294" stroke-width="1.2"/></marker></defs>']
        self.rect(0,0,w,h,C['bg'],0)
    def rect(self,x,y,w,h,fill=None,r=16,stroke=None,shadow=False):
        self.s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill or C["white"]}"'+(f' stroke="{stroke}"' if stroke else '')+'/>')
    def text(self,x,y,txt,size=18,color=None,weight=400,anchor='start'):
        self.s.append(f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{color or C["ink"]}" text-anchor="{anchor}">{escape(txt)}</text>')
    def lines(self,x,y,lines,size=18,color=None,weight=400,gap=None):
        for i,line in enumerate(lines): self.text(x,y+i*(gap or size*1.55),line,size,color,weight)
    def line(self,x1,y1,x2,y2,color=None,dash=False,arrow=False,width=1):
        self.s.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color or C["line"]}" stroke-width="{width}"'+(' stroke-dasharray="5 5"' if dash else '')+(' marker-end="url(#arrow)"' if arrow else '')+'/>')
    def circle(self,x,y,r,fill):self.s.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>')
    def pill(self,x,y,w,label,bg=None,ink=None,size=14):
        self.rect(x,y,w,28,bg or C['pale'],14)
        self.text(x+w/2,y+19,label,size,ink or C['green'],500,'middle')
    def button(self,x,y,w,label,primary=False):
        self.rect(x,y,w,44,C['green'] if primary else C['white'],10,None if primary else C['line'])
        self.text(x+w/2,y+29,label,16,C['white'] if primary else C['green'],600,'middle')
    def header(self,active='开始学习'):
        self.rect(0,0,self.w,42,C['green'],0)
        self.text(40,28,'目标设计示意 · 尚未实现',16,C['white'],600)
        self.text(self.w-40,28,'非真实用户记录 / 非实时运行',14,'#D2E4D4',400,'end')
        self.rect(0,42,self.w,82,C['white'],0)
        self.rect(40,65,36,36,C['green'],10)
        self.rect(48,85,5,9,'#DAEAC6',1);self.rect(56,79,5,15,'#DAEAC6',1);self.rect(64,72,5,22,'#DAEAC6',1)
        self.text(88,91,'EcoSimEdu',24,C['ink'],700)
        x=380
        for label in ['开始学习','学习路径','案例库','我的学习']:
            self.text(x,91,label,17,C['green'] if label==active else C['sub'],600 if label==active else 400)
            if label==active:self.line(x,111,x+68,111,C['green'],width=3)
            x+=128
        self.text(self.w-180,91,'自由实验',16,C['sub'])
        self.pill(self.w-102,69,62,'离线',C['pale'])
        self.line(0,124,self.w,124)
    def save(self):
        self.s.append('</svg>')
        p=ROOT/(self.name+'.svg');p.write_text('\n'.join(self.s),encoding='utf-8')
        print(p)

b=Board('learning_home',1440,1070,'学习首页目标设计','展示学习目标、继续任务、到期复习、带理由的下一课，以及彼此分开的活动进度与能力证据。所有状态均为设计示意。')
b.header()
b.text(56,171,'你的学习工作台',15,C['sub'],500)
b.text(56,221,'今天，把一个机制讲清楚。',37,C['ink'],700)
b.text(56,256,'从上次的问题继续，也可以先做一项短练习。',18,C['sub'])
b.rect(1036,162,348,100,C['pale'],16)
b.text(1060,193,'当前学习目标',14,C['sub'],500)
b.text(1060,223,'解释信息与流动性的相互影响',17,C['green'],600)
b.text(1060,247,'金融中的信息与流动性   ·   更换目标 →',13,C['sub'])

b.rect(56,290,804,356,C['white'],20,C['line'],True)
b.pill(80,314,108,'继续核心任务')
b.text(80,377,'银行缺现金，就一定破产了吗？',29,C['ink'],700)
b.text(80,412,'SVB 案例 · 区分即时支付能力与净资产',17,C['sub'])
b.rect(80,437,756,76,C['subtle'],12)
b.text(100,466,'你上次停在：现金缺口判断',17,C['ink'],600)
b.text(100,494,'先核对账表，再把相关记录加入自己的解释。',16,C['sub'])
b.button(80,534,172,'继续这个任务 →',True)
b.text(274,563,'约 5–8 分钟 · 设计预算',14,C['sub'])
b.line(80,599,836,599)
b.text(80,626,'主线活动',14,C['sub'])
for i in range(7):b.rect(165+i*24,613,17,8,C['green'] if i<4 else C['line'],4)
b.text(349,626,'4 / 7 · 示例状态',14,C['sub'])
b.text(533,626,'能力证据',14,C['sub'])
b.pill(614,607,170,'练习中',C['blue'],C['blueink'],14)

b.rect(884,290,500,166,C['white'],20,C['line'],True)
b.pill(908,312,94,'待复习',C['amber'],C['amberink'])
b.text(908,375,'价格与价值：再区分一次',23,C['ink'],700)
b.text(908,405,'原因：上次使用过提示，本次换一个情境检验。',15,C['sub'])
b.text(908,435,'建议先回忆，再查看笔记',14,C['sub'])
b.text(1358,435,'开始短练 →',16,C['green'],600,'end')

b.rect(884,480,500,166,C['white'],20,C['line'],True)
b.pill(908,502,94,'下一课',C['pale'])
b.text(908,565,'闪电崩盘：订单簿为何变薄',23,C['ink'],700)
b.text(908,595,'推荐原因：完成当前现金任务后，比较另一种',15,C['sub'])
b.text(908,619,'流动性机制。银行资产与订单深度需要分开。',15,C['sub'])
b.text(1358,635,'查看目标 →',14,C['green'],600,'end')

b.text(56,698,'我的理解，有哪些证据？',25,C['ink'],700)
b.text(56,728,'活动完成说明你做过什么；能力证据说明你在哪些任务中独立应用过。',16,C['sub'])
b.text(1384,703,'打开概念档案 →',16,C['green'],600,'end')
for x,title,tag,lines,foot,bg,ink in [
 (56,'价格、价值与剩余','练习中',['曾使用提示 · 尝试记录可查','下一步：不看提示完成新题'],'查看尝试与帮助记录',C['blue'],C['blueink']),
 (508,'现金与净资产','练习中',['独立应用尚待验证','运行完成不自动证明理解'],'返回当前任务',C['blue'],C['blueink']),
 (960,'个体选择与群体结果','有独立应用证据',['Schelling 新变式判断','可查看题目、版本和解释'],'查看支持这项状态的证据',C['pale'],C['green'])]:
    b.rect(x,754,424,218,C['white'],18,C['line'])
    b.text(x+24,792,title,22,C['ink'],700)
    b.pill(x+24,811,176,tag,bg,ink)
    if x==56: b.pill(x+218,811,106,'待复习',C['amber'],C['amberink'])
    if x==960: b.pill(x+218,811,126,'迁移待练',C['blue'],C['blueink'])
    b.lines(x+24,873,lines,16,C['sub'],gap=29)
    b.text(x+24,946,foot+' →',14,C['green'],500)

b.line(56,1005,1384,1005)
b.text(56,1038,'示例学习状态仅用于说明布局；不代表真实用户表现或已产生的学习效果。',14,C['sub'])
b.text(1384,1038,'学习记录保留在本机',14,C['sub'],anchor='end')
b.save()

b=Board('learning_activity',1560,1140,'SVB 学习活动目标设计','展示教学例题、银行账表、当前必要任务、提示后作答状态、阶段目录和未填写的主张证据机制边界解释卡。不展示或伪造实时运行。')
b.header('学习路径')
b.text(40,161,'金融中的信息与流动性  /  SVB 银行挤兑  /  认识约束',14,C['sub'])
b.text(40,205,'现金不足，等于资不抵债吗？',33,C['ink'],700)
b.text(40,236,'目标：给定银行账表，区分即时现金缺口与净资产。',17,C['sub'])
b.pill(1314,187,206,'教学例题 · 非历史数据',C['amber'],C['amberink'],14)

# activity navigation
b.rect(40,264,226,634,C['white'],18,C['line'])
b.text(60,302,'这节课的活动',18,C['ink'],700)
b.text(60,332,'保存位置与回答，随时可继续。',12,C['sub'])
nav=[('01','问题与角色','当前阶段',354),('02','预测行为','待进行',522),('03','选择行动','待进行',578),('04','观察演化','待进行',634),('05','解释涌现','待进行',690),('06','反事实比较','后续任务',746),('07','总结迁移','后续任务',802)]
for number,label,status,y in nav:
    b.circle(75,y+6,14,C['pale'] if number=='01' else C['subtle'])
    b.text(75,y+11,number,11,C['green'] if number=='01' else C['mute'],600,'middle')
    b.text(99,y+8,label,16,C['ink'],600 if number=='01' else 400)
    b.text(99,y+31,status,12,C['sub'])
b.rect(58,400,190,49,C['pale'],9)
b.text(70,421,'必要 · 账表判断',14,C['green'],600)
b.text(70,440,'当前正在回答',11,C['sub'])
b.text(70,474,'可选 · 证券折价会怎样',13,C['sub'])
b.text(70,496,'完成必要任务后再探索',11,C['mute'])
b.line(60,846,246,846)
b.text(60,869,'主线活动与能力证据',13,C['ink'],600)
b.lines(60,890,['分别记录，不互相替代。'],12,C['sub'])

# bank balance problem
b.rect(290,264,734,360,C['white'],18,C['line'])
b.text(314,302,'银行账表',23,C['ink'],700)
b.pill(866,281,134,'题设 · 单位：代币',C['subtle'],C['sub'],12)
b.text(314,333,'这是人工编写的学习题；不对应真实 SVB 财务或任何运行结果。',14,C['sub'])
b.line(314,354,1000,354)
b.text(314,389,'资产',16,C['sub'],600)
b.text(676,389,'负债与净资产',16,C['sub'],600)
for x,y,w,label,value in [(314,406,320,'现金','8'),(314,482,320,'证券账面价值','92'),(676,406,324,'存款负债','90'),(676,482,324,'净资产','待你计算')]:
    b.rect(x,y,w,62,C['subtle'],10)
    b.text(x+16,y+26,label,14,C['sub'])
    b.text(x+w-16,y+47,value,26 if value!='待你计算' else 18,C['ink'],700,'end')
b.text(314,586,'题设约束：此刻不出售证券、不新增借款。',15,C['green'],500)
b.text(314,609,'新到达的提款要求为 15 代币。先判断即时支付能力。',14,C['sub'])

# task right
b.rect(1048,264,472,496,C['white'],18,C['line'],True)
b.pill(1072,285,108,'当前必要任务')
b.text(1072,348,'先判断，再解释依据',24,C['ink'],700)
b.lines(1072,385,['仅用题设现金支付，银行还差多少？'],17,C['sub'])
b.rect(1072,405,178,52,C['subtle'],9,C['line'])
b.text(1090,439,'输入数值',17,C['mute'])
b.text(1266,439,'代币',16,C['sub'])
b.text(1072,496,'这是否已经证明净资产为负？',17,C['ink'],600)
for x,w,l in [(1072,116,'是'),(1200,116,'否'),(1328,168,'还不确定')]:
    b.rect(x,513,w,42,C['white'],9,C['line']);b.text(x+w/2,540,l,15,C['sub'],500,'middle')
b.rect(1072,577,424,62,C['amber'],10)
b.text(1088,603,'已查看提示 1 · 本次记为辅助练习',14,C['amberink'],600)
b.text(1088,626,'完成后，可用一道新变式检验独立应用。',13,C['amberink'])
b.button(1072,659,234,'提交本次回答',True)
b.text(1330,687,'查看下一层提示',14,C['green'],500)
b.text(1072,733,'答错或选择不确定都可以继续学习。',14,C['sub'])

# mechanism preview
b.rect(290,648,734,112,C['pale'],18)
b.text(314,680,'接下来要解释的联系',16,C['green'],600)
labels=[(314,'储户提出提款'),(534,'银行面临支付约束'),(792,'资产处置与反馈')]
for x,t in labels:b.text(x,718,t,15,C['ink'],500)
b.line(426,712,514,712,'#8CA294',arrow=True)
b.line(680,712,772,712,'#8CA294',arrow=True)
b.text(314,744,'机制示意；实际实验中再用可见事件逐步查证。',12,C['sub'])

# notebook preview one piece at a time
b.rect(290,784,1230,274,C['white'],18,C['line'])
b.text(314,825,'把发现写成自己的解释',24,C['ink'],700)
b.text(314,854,'解题后继续 · 当前卡片尚未填写；先完成上方这一项任务。',14,C['sub'])
b.pill(1360,803,136,'解释卡 · 草稿',C['subtle'],C['sub'],13)
cols=[(314,'1  主张',['用一句话回答：','现金不足说明什么？']),
      (610,'2  证据',['从真实运行加入原事件；','本例题题设单独标识。']),
      (906,'3  机制',['个体行动 → 相互作用','→ 集体结果']),
      (1202,'4  边界',['写明成立条件，','并提出另一种可能。'])]
for x,t,ls in cols:
    b.rect(x,880,270,134,C['subtle'],11)
    b.text(x+16,910,t,17,C['ink'],600)
    b.lines(x+16,945,ls,14,C['mute'],gap=26)
b.text(314,1041,'分别检查：引用可核对  ·  结构完整  ·  概念与机制需要复核',13,C['sub'])

b.line(40,1082,1520,1082)
b.text(40,1114,'目标界面设计，不是现有产品截图。数值仅为教学例题；输入、证据和解释均未伪造完成状态。',14,C['sub'])
b.save()
