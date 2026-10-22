package
{
   import dragonforce.GameEngine;
   import dragonforce.core.GroundTile;
   import dragonforce.core.SpriteSheet;
   import dragonforce.isometric2D.Isometric2DEntity;
   import dragonforce.math.Vec2;
   import flash.display.Sprite;
   import flash.events.DataEvent;
   import flash.events.Event;
   import flash.events.MouseEvent;
   import flash.media.Sound;
   import flash.media.SoundTransform;
   import flash.utils.Dictionary;
   import flash.utils.getTimer;
   
   public class DragonForce extends GameEngine
   {
      
      public var KP1_U:int = 87;
      
      public var KP1_D:int = 83;
      
      public var KP1_L:int = 65;
      
      public var KP1_R:int = 68;
      
      public var KP2_U:int = 38;
      
      public var KP2_D:int = 40;
      
      public var KP2_L:int = 37;
      
      public var KP2_R:int = 39;
      
      public var KCM_U:int = 73;
      
      public var KCM_D:int = 75;
      
      public var KCM_L:int = 74;
      
      public var KCM_R:int = 76;
      
      public var K_space:int = 32;
      
      public var K_enter:int = 13;
      
      public var K_plus:int = 187;
      
      public var K_minus:int = 189;
      
      public var stopTimer:Boolean = false;
      
      public var storm:SpriteSheet;
      
      public var fb:SpriteSheet;
      
      public var tb:SpriteSheet;
      
      public var sred:SpriteSheet;
      
      public var sblue:SpriteSheet;
      
      public var friendList:Vector.<Isometric2DEntity> = new Vector.<Isometric2DEntity>();
      
      public var enemyList:Vector.<Isometric2DEntity> = new Vector.<Isometric2DEntity>();
      
      public var grid:Grid = new Grid();
      
      public var ui:Sprite;
      
      public var round:int = 180;
      
      public var mapWidth:int = 4500;
      
      public var mapHeight:int = 800;
      
      public var incomeLimit:int = 8000;
      
      public var populationLimit:int = 80;
      
      public var leftMoney:int = 0;
      
      public var leftIncome:int = 100;
      
      public var leftPopulation:int = this.populationLimit;
      
      public var rightMoney:int = 0;
      
      public var rightIncome:int = 100;
      
      public var rightPopulation:int = this.populationLimit;
      
      public var SD_dead1:Sound;
      
      public var SD_dead2:Sound;
      
      public var SD_dead3:Sound;
      
      public var SD_dead4:Sound;
      
      public var SD_dead5:Sound;
      
      public var SD_dead6:Sound;
      
      public var SD_dao:Sound;
      
      public var SD_cha:Sound;
      
      public var SD_cheer:Sound;
      
      public var SD_Timer:Sound;
      
      public var SD_btns:Sound;
      
      public var singlePlay:Boolean = true;
      
      public var difficulty:int;
      
      private var redBoss:Isometric2DEntity;
      
      private var blueBoss:Isometric2DEntity;
      
      private var ssRed:Vector.<SpriteSheet> = new Vector.<SpriteSheet>();
      
      private var ssBlue:Vector.<SpriteSheet> = new Vector.<SpriteSheet>();
      
      private var mouseMapDown:Boolean = false;
      
      private var p1:Array = [0,0,1];
      
      private var p2:Array = [0,0,1];
      
      private var gameOverTime:int = 30;
      
      private var cameraTime:int = 0;
      
      private const MWS:Class = DragonForce_MWS;
      
      public function DragonForce()
      {
         super();
         library.loadBytes(new this.MWS());
         library.addEventListener(Event.COMPLETE,this.libraryComplete);
      }
      
      public function initUI(param1:Sprite) : void
      {
         var id:int;
         var onMouse:Function = null;
         var onClick:Function = null;
         var tmp:Object = null;
         var src:String = null;
         var ui:Sprite = param1;
         var textColor:Function = function(param1:String, param2:String):String
         {
            return "<font color=\'" + param2 + "\'>" + param1 + "</font><br>";
         };
         onMouse = function(param1:MouseEvent):void
         {
            switch(param1.type)
            {
               case MouseEvent.MOUSE_DOWN:
                  mouseMapDown = true;
                  break;
               case MouseEvent.MOUSE_UP:
                  mouseMapDown = false;
            }
         };
         onClick = function(param1:MouseEvent):void
         {
            switch(param1.currentTarget.data[0])
            {
               case "p1":
                  p1[0] = param1.currentTarget.data[1];
                  p1[1] = param1.currentTarget.data[2];
                  break;
               case "p2":
                  p2[0] = param1.currentTarget.data[1];
                  p2[1] = param1.currentTarget.data[2];
            }
            SD_btns.play();
         };
         this.ui = ui;
         Object(ui).map.addEventListener(MouseEvent.MOUSE_DOWN,onMouse);
         Object(ui).stage.addEventListener(MouseEvent.MOUSE_UP,onMouse);
         id = 0;
         while(id < 16)
         {
            tmp = this.grid.entity[id];
            src = textColor(tmp.name,"#ffffff");
            src += textColor("消耗资源: 金币 " + tmp.cost + " 人力 " + tmp.population,"#ffffff");
            src += textColor("收入增加: 金币 " + tmp.income + " 每个回合","#ffffff");
            src += "<br>" + textColor("HP:" + tmp.hp,"#ffd100");
            src += textColor("护甲值:" + tmp.armor,"#ffd100");
            src += textColor("护甲类型:" + (tmp.armorTypeID == 0 ? "轻甲" : "重甲"),"#ffd100");
            src += textColor("移动速度:" + tmp.moveSpeed,"#ffd100");
            src += "<br>" + textColor("攻击力对轻甲:" + tmp.damage[0],"#ffd100");
            src += textColor("攻击力对重甲:" + tmp.damage[1],"#ffd100");
            src += textColor("攻击距离:" + tmp.range,"#ffd100");
            src += textColor("攻击速度:" + tmp.weaponSpeed,"#ffd100");
            src = "<textformat leading=\'3\'>" + src + "</textformat>";
            Object(ui)["a" + id].dispatchEvent(new DataEvent("tips",true,false,src));
            Object(ui)["a" + id].addEventListener(MouseEvent.CLICK,onClick);
            Object(ui)["a" + id].buttonMode = true;
            Object(ui)["a" + id].data = ["p1",id % 8,int(id / 8)];
            Object(ui)["b" + id].dispatchEvent(new DataEvent("tips",true,false,src));
            if(!this.singlePlay)
            {
               Object(ui)["b" + id].addEventListener(MouseEvent.CLICK,onClick);
               Object(ui)["b" + id].buttonMode = true;
               Object(ui)["b" + id].data = ["p2",id % 8,int(id / 8)];
            }
            id++;
         }
         this.init();
      }
      
      private function libraryComplete(param1:Event) : void
      {
         var _loc2_:int = 0;
         var _loc3_:SpriteSheet = null;
         var _loc4_:SpriteSheet = null;
         keyManager.addKeyHitter([this.KP1_U],false,this.P1Control,0,-1,0);
         keyManager.addKeyHitter([this.KP1_D],false,this.P1Control,0,1,0);
         keyManager.addKeyHitter([this.KP1_L],false,this.P1Control,-1,0,0);
         keyManager.addKeyHitter([this.KP1_R],false,this.P1Control,1,0,0);
         keyManager.addKeyHitter([this.K_space],false,this.P1Control,0,0,1);
         keyManager.addKeyHitter([this.KP2_U],false,this.P2Control,0,-1,0);
         keyManager.addKeyHitter([this.KP2_D],false,this.P2Control,0,1,0);
         keyManager.addKeyHitter([this.KP2_L],false,this.P2Control,-1,0,0);
         keyManager.addKeyHitter([this.KP2_R],false,this.P2Control,1,0,0);
         keyManager.addKeyHitter([this.K_enter],false,this.P2Control,0,0,1);
         keyManager.addKeyHitter([this.KCM_U],true,this.steer,new Vec2(0,-5));
         keyManager.addKeyHitter([this.KCM_D],true,this.steer,new Vec2(0,5));
         keyManager.addKeyHitter([this.KCM_L],true,this.steer,new Vec2(-5,0));
         keyManager.addKeyHitter([this.KCM_R],true,this.steer,new Vec2(5,0));
         keyManager.addKeyHitter([this.KCM_U,this.KCM_R],true,this.steer,new Vec2(5,-5));
         keyManager.addKeyHitter([this.KCM_R,this.KCM_D],true,this.steer,new Vec2(5,5));
         keyManager.addKeyHitter([this.KCM_D,this.KCM_L],true,this.steer,new Vec2(-5,5));
         keyManager.addKeyHitter([this.KCM_L,this.KCM_U],true,this.steer,new Vec2(-5,-5));
         keyManager.addKeyHitter([this.K_plus],false,this.destoryUnit,0.02);
         keyManager.addKeyHitter([this.K_minus],false,this.destoryUnit,-0.02);
         this.SD_dead1 = library.getInstance("SD_dead1");
         this.SD_dead2 = library.getInstance("SD_dead2");
         this.SD_dead3 = library.getInstance("SD_dead3");
         this.SD_dead4 = library.getInstance("SD_dead4");
         this.SD_dead5 = library.getInstance("SD_dead5");
         this.SD_dead6 = library.getInstance("SD_dead6");
         this.SD_cheer = library.getInstance("SD_cheer");
         this.SD_Timer = library.getInstance("SD_Timer");
         this.SD_dao = library.getInstance("SD_dao");
         this.SD_cha = library.getInstance("SD_cha");
         this.SD_btns = library.getInstance("SD_btns");
         this.fb = new SpriteSheet();
         this.fb.createActionFromMovieClip("idle",library.getInstance("fireball"),true,0.15);
         this.tb = new SpriteSheet();
         this.tb.createActionFromMovieClip("idle",library.getInstance("thunderball"),true);
         this.storm = new SpriteSheet();
         this.storm.createActionFromMovieClip("idle",library.getInstance("storm"),true);
         this.sred = new SpriteSheet();
         this.sred.createActionFromMovieClip("idle",library.getInstance("A_crystal"));
         this.sred.createActionFromMovieClip("run",library.getInstance("A_crystal"));
         this.sred.createActionFromMovieClip("attack",library.getInstance("A_crystal"));
         this.sred.createActionFromMovieClip("dead",library.getInstance("A_crystal"));
         this.sblue = new SpriteSheet();
         this.sblue.createActionFromMovieClip("idle",library.getInstance("B_crystal"));
         this.sblue.createActionFromMovieClip("run",library.getInstance("B_crystal"));
         this.sblue.createActionFromMovieClip("attack",library.getInstance("B_crystal"));
         this.sblue.createActionFromMovieClip("dead",library.getInstance("B_crystal"));
         while(_loc2_ < 16)
         {
            _loc3_ = new SpriteSheet();
            _loc3_.createActionFromMovieClip("idle",library.getInstance("A" + _loc2_ + "_idle"),true,0.15);
            _loc3_.createActionFromMovieClip("run",library.getInstance("A" + _loc2_ + "_run"),true,0.3);
            _loc3_.createActionFromMovieClip("attack",library.getInstance("A" + _loc2_ + "_attack"),false,0.3);
            _loc3_.createActionFromMovieClip("dead",library.getInstance("A" + _loc2_ + "_dead"),false,0.2);
            this.ssRed.push(_loc3_);
            _loc4_ = new SpriteSheet();
            _loc4_.createActionFromMovieClip("idle",library.getInstance("B" + _loc2_ + "_idle"),true,0.15);
            _loc4_.createActionFromMovieClip("run",library.getInstance("B" + _loc2_ + "_run"),true,0.3);
            _loc4_.createActionFromMovieClip("attack",library.getInstance("B" + _loc2_ + "_attack"),false,0.3);
            _loc4_.createActionFromMovieClip("dead",library.getInstance("B" + _loc2_ + "_dead"),false,0.2);
            this.ssBlue.push(_loc4_);
            _loc2_++;
         }
         _loc2_ = 0;
         while(_loc2_ < 13)
         {
            scene.addGroundTile(new GroundTile(library.getInstance("terrain"),-900,-1600 + _loc2_ * 300,9800,300));
            _loc2_++;
         }
         scene.bg1BitmapData = library.getInstance("bg1");
         scene.bg2BitmapData = library.getInstance("bg2");
         camera.x = 2000;
         camera.y = 150;
         camera.limitInMap(1.15 * this.mapWidth,1.5 * this.mapHeight);
      }
      
      public function init() : void
      {
         while(scene.numChildren > 0)
         {
            scene.removeChildAt(0);
         }
         this.round = 6 * 30;
         this.gameOverTime = 30;
         this.friendList = new Vector.<Isometric2DEntity>();
         this.enemyList = new Vector.<Isometric2DEntity>();
         this.redBoss = new Isometric2DEntity();
         this.redBoss.targetList = this.enemyList;
         this.redBoss.spriteSheet = this.sred;
         this.redBoss.nowHP = 3500;
         this.redBoss.maxHP = 3500;
         this.redBoss.weaponSpriteSheet = this.fb;
         this.redBoss.damage = [100,100];
         this.redBoss.weaponSpeed = 30;
         this.redBoss.range = 600;
         this.redBoss.px = 300;
         this.redBoss.py = this.mapHeight / 2;
         this.friendList.push(this.redBoss);
         scene.addChild(this.redBoss);
         this.blueBoss = new Isometric2DEntity();
         this.blueBoss.targetList = this.friendList;
         this.blueBoss.spriteSheet = this.sblue;
         this.blueBoss.nowHP = 3500;
         this.blueBoss.maxHP = 3500;
         this.blueBoss.weaponSpriteSheet = this.tb;
         this.blueBoss.damage = [100,100];
         this.blueBoss.weaponSpeed = 30;
         this.blueBoss.range = 600;
         this.blueBoss.px = this.mapWidth - 300;
         this.blueBoss.py = this.mapHeight / 2;
         this.enemyList.push(this.blueBoss);
         scene.addChild(this.blueBoss);
         this.leftMoney = 0;
         this.leftIncome = 500;
         this.leftPopulation = this.populationLimit;
         this.rightMoney = 0;
         this.rightIncome = 500;
         this.rightPopulation = this.populationLimit;
         this.p1 = [0,0,1];
         this.p2 = [0,0,1];
         if(this.difficulty == 3)
         {
            this.blueBoss.damage = [110,110];
            this.blueBoss.weaponSpeed = 25;
            this.rightIncome = 600;
            this.rightPopulation = 100;
         }
         startEngine();
      }
      
      public function destory() : void
      {
         var _loc1_:int = 0;
         var _loc2_:int = 0;
         while(_loc1_ < this.ssRed.length)
         {
            this.ssRed[_loc1_].destory();
            _loc1_++;
         }
         while(_loc2_ < this.ssRed.length)
         {
            this.ssBlue[_loc2_].destory();
            _loc2_++;
         }
         this.fb.destory();
         this.tb.destory();
         this.storm.destory();
         this.destoryUnit(1);
         this.destoryUnit(-1);
      }
      
      private function steer(param1:Vec2) : void
      {
         this.cameraTime = 60;
         camera.x += param1.x * 4;
         camera.y += param1.y * 4;
      }
      
      private function P1Control(param1:int, param2:int, param3:int) : void
      {
         this.p1[0] = Math.max(0,Math.min(this.p1[0] + param1,7));
         this.p1[1] = Math.max(0,Math.min(this.p1[1] + param2,1));
         if(param3 == 1)
         {
            if(this.p1[2] == 0)
            {
               this.p1[2] = 1;
            }
            else
            {
               this.p1[2] = 0;
            }
         }
         this.SD_btns.play();
      }
      
      private function P2Control(param1:int, param2:int, param3:int) : void
      {
         if(this.singlePlay)
         {
            return;
         }
         this.p2[0] = Math.max(0,Math.min(this.p2[0] + param1,7));
         this.p2[1] = Math.max(0,Math.min(this.p2[1] + param2,1));
         if(param3 == 1)
         {
            if(this.p2[2] == 0)
            {
               this.p2[2] = 1;
            }
            else
            {
               this.p2[2] = 0;
            }
         }
         this.SD_btns.play();
      }
      
      private function destoryUnit(param1:Number) : void
      {
         var _loc2_:* = 0;
         if(param1 > 0)
         {
            _loc2_ = int(this.friendList.length);
            while(_loc2_-- > 0)
            {
               if(this.friendList[_loc2_] != this.redBoss)
               {
                  this.friendList[_loc2_].dead();
               }
            }
         }
         else
         {
            _loc2_ = int(this.enemyList.length);
            while(_loc2_-- > 0)
            {
               if(this.enemyList[_loc2_] != this.blueBoss)
               {
                  this.enemyList[_loc2_].dead();
               }
            }
         }
      }
      
      private function createUnit(param1:Number, param2:int = 0) : void
      {
         var _loc3_:Isometric2DEntity = null;
         if(param1 > 0)
         {
            if(this.leftMoney - this.grid.entity[param2].cost >= 0 && this.leftPopulation - this.grid.entity[param2].population >= 0)
            {
               this.leftMoney -= this.grid.entity[param2].cost;
               this.leftIncome += this.grid.entity[param2].income;
               if(this.leftIncome > this.incomeLimit)
               {
                  this.leftIncome = this.incomeLimit;
               }
               this.leftPopulation -= this.grid.entity[param2].population;
               _loc3_ = new Isometric2DEntity();
               _loc3_.data = "left";
               _loc3_.targetList = this.enemyList;
               _loc3_.spriteSheet = this.ssRed[this.grid.entity[param2].ss];
               if(this.grid.entity[param2].wss != null)
               {
                  _loc3_.weaponSpriteSheet = this[this.grid.entity[param2].wss];
               }
               _loc3_.nowHP = this.grid.entity[param2].hp;
               _loc3_.armorTypeID = this.grid.entity[param2].armorTypeID;
               _loc3_.armor = this.grid.entity[param2].armor;
               _loc3_.moveSpeed = this.grid.entity[param2].moveSpeed * 1.3;
               _loc3_.damage = this.grid.entity[param2].damage;
               _loc3_.range = this.grid.entity[param2].range * 60;
               _loc3_.weaponSpeed = this.grid.entity[param2].weaponSpeed * 20;
               _loc3_.delayAttack = this.grid.entity[param2].delayAttack;
               _loc3_.gotoAndPlay("idle");
               _loc3_.px = 300;
               _loc3_.py = this.mapHeight / 2 + (200 - 400 * Math.random());
               _loc3_.addEventListener("destroy",this.onDead);
               _loc3_.addEventListener("attack",this.onAttack);
               _loc3_.id = param2;
               this.friendList.push(_loc3_);
               scene.addChild(_loc3_);
               if(this.ui)
               {
                  Object(this.ui).p1.scaleX = Object(this.ui).p1.scaleY = 1.4;
                  Object(this.ui).p1.alpha = 1;
               }
            }
         }
         else if(this.rightMoney - this.grid.entity[param2].cost >= 0 && this.rightPopulation - this.grid.entity[param2].population >= 0)
         {
            this.rightMoney -= this.grid.entity[param2].cost;
            this.rightIncome += this.grid.entity[param2].income;
            if(this.rightIncome > this.incomeLimit)
            {
               this.rightIncome = this.incomeLimit;
            }
            this.rightPopulation -= this.grid.entity[param2].population;
            _loc3_ = new Isometric2DEntity();
            _loc3_.data = "right";
            _loc3_.targetList = this.friendList;
            _loc3_.spriteSheet = this.ssBlue[this.grid.entity[param2].ss];
            if(this.grid.entity[param2].wss != null)
            {
               _loc3_.weaponSpriteSheet = this[this.grid.entity[param2].wss];
            }
            _loc3_.nowHP = this.grid.entity[param2].hp;
            _loc3_.armorTypeID = this.grid.entity[param2].armorTypeID;
            _loc3_.armor = this.grid.entity[param2].armor;
            _loc3_.moveSpeed = this.grid.entity[param2].moveSpeed * 1.3;
            _loc3_.damage = this.grid.entity[param2].damage;
            _loc3_.range = this.grid.entity[param2].range * 60;
            _loc3_.weaponSpeed = this.grid.entity[param2].weaponSpeed * 20;
            _loc3_.delayAttack = this.grid.entity[param2].delayAttack;
            _loc3_.gotoAndPlay("idle");
            _loc3_.px = this.mapWidth - 300;
            _loc3_.py = this.mapHeight / 2 + (200 - 400 * Math.random());
            _loc3_.id = param2;
            _loc3_.addEventListener("destroy",this.onDead);
            _loc3_.addEventListener("attack",this.onAttack);
            this.enemyList.push(_loc3_);
            scene.addChild(_loc3_);
            if(this.ui)
            {
               Object(this.ui).p2.scaleX = Object(this.ui).p2.scaleY = 1.4;
               Object(this.ui).p2.alpha = 1;
            }
         }
      }
      
      private function onDead(param1:Event) : void
      {
         var _loc2_:Vector.<Isometric2DEntity> = param1.target.data == "left" ? this.friendList : this.enemyList;
         var _loc3_:int = _loc2_.indexOf(param1.target);
         if(_loc3_ != -1)
         {
            _loc2_.splice(_loc3_,1);
         }
         if(Math.random() > 0.5)
         {
            this.SD_dead3.play();
         }
      }
      
      private function onAttack(param1:Event) : void
      {
         if(param1.currentTarget.id == 6 || param1.currentTarget.id == 9 || param1.currentTarget.id == 12)
         {
            return;
         }
         var _loc2_:Number = Math.random();
         if(_loc2_ > 0.9)
         {
            this.SD_dao.play(0,0,new SoundTransform(0.2));
         }
         if(_loc2_ < 0.1)
         {
            this.SD_cha.play(0,0,new SoundTransform(0.5));
         }
      }
      
      private function ai() : void
      {
         var _loc2_:* = 0;
         var _loc3_:Dictionary = null;
         var _loc4_:int = 0;
         var _loc5_:int = 0;
         var _loc6_:Object = null;
         var _loc7_:Array = null;
         var _loc1_:Number = 0;
         switch(this.difficulty)
         {
            case 0:
               _loc1_ = 0;
               break;
            case 1:
               _loc1_ = 0.5;
               break;
            case 2:
               _loc1_ = 1;
               break;
            case 3:
               _loc1_ = 1;
         }
         if(_loc1_ > Math.random())
         {
            _loc2_ = int(this.friendList.length);
            _loc3_ = new Dictionary(true);
            while(_loc2_-- > 0)
            {
               if(_loc3_[this.friendList[_loc2_].id] == undefined)
               {
                  _loc3_[this.friendList[_loc2_].id] = 1;
               }
               else
               {
                  ++_loc3_[this.friendList[_loc2_].id];
               }
               if(this.friendList[_loc2_].id == 14 || this.friendList[_loc2_].id == 15)
               {
                  _loc4_++;
               }
            }
            _loc2_ = 1;
            _loc5_ = -1;
            for(_loc6_ in _loc3_)
            {
               if(_loc3_[_loc6_] > _loc2_)
               {
                  _loc2_ = int(_loc3_[_loc6_]);
                  _loc5_ = _loc6_ as int;
               }
            }
            if(_loc5_ == 0)
            {
               if(this.rightIncome < 200)
               {
                  _loc2_ = 0;
               }
               else
               {
                  _loc2_ = 3;
               }
            }
            else if(_loc5_ == 1)
            {
               _loc7_ = [1,3,5];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 2)
            {
               _loc7_ = [4,6,7,8];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 3)
            {
               _loc7_ = [4,7];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 4)
            {
               _loc7_ = [1,6,8];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 5)
            {
               _loc7_ = [3,10];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 6)
            {
               _loc7_ = [5,6,12];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 7)
            {
               _loc7_ = [4,8,9];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 8)
            {
               _loc7_ = [5,6,12];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 9)
            {
               _loc7_ = [6,8,9,11];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 10)
            {
               _loc7_ = [11,13,14];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 11)
            {
               _loc7_ = [8,9];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 12)
            {
               _loc7_ = [9,10,12,13];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 13)
            {
               _loc7_ = [8,9,11];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 14)
            {
               _loc7_ = [9,10,11];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(_loc5_ == 15)
            {
               _loc7_ = [9,10,11];
               _loc2_ = int(_loc7_[int(Math.random() * _loc7_.length)]);
            }
            else if(this.rightIncome > 1000)
            {
               _loc2_ = int(Math.random() * 16);
            }
            else
            {
               _loc2_ = 0;
            }
         }
         else if(this.rightIncome > 450)
         {
            _loc2_ = int(Math.random() * 14);
         }
         else
         {
            _loc2_ = int(Math.random() * 8);
         }
         if(this.rightMoney > 15030 || _loc4_ > 2)
         {
            _loc2_ = 15;
         }
         this.p2[0] = _loc2_ % 8;
         this.p2[1] = int(_loc2_ / 8);
      }
      
      override protected function step(param1:Event = null) : void
      {
         var _loc3_:* = 0;
         var _loc4_:* = 0;
         var _loc5_:Number = NaN;
         var _loc6_:Isometric2DEntity = null;
         var _loc7_:Isometric2DEntity = null;
         var _loc8_:Number = NaN;
         var _loc9_:Number = NaN;
         var _loc10_:int = 0;
         var _loc11_:Isometric2DEntity = null;
         var _loc12_:Number = NaN;
         var _loc2_:int = getTimer();
         super.step();
         _loc3_ = int(this.friendList.length);
         if(_loc3_ > 1)
         {
            while(_loc3_-- > 1)
            {
               _loc6_ = this.friendList[_loc3_];
               _loc4_ = int(_loc3_);
               while(_loc4_-- > 0)
               {
                  _loc7_ = this.friendList[_loc4_];
                  if(_loc6_ != _loc7_)
                  {
                     _loc8_ = _loc6_.px - _loc7_.px;
                     _loc9_ = _loc6_.py - _loc7_.py;
                     _loc5_ = _loc8_ * _loc8_ + _loc9_ * _loc9_;
                     if(_loc5_ < 1600)
                     {
                        _loc5_ = Math.sqrt(_loc5_);
                        _loc8_ = _loc5_ == 0 ? 0 : _loc8_ / _loc5_;
                        _loc9_ = _loc5_ == 0 ? 0 : _loc9_ / _loc5_;
                        _loc6_.px += _loc8_ * (40 - _loc5_);
                        _loc6_.py += _loc9_ * (40 - _loc5_);
                     }
                  }
               }
               if(_loc6_.px > _loc10_)
               {
                  _loc10_ = _loc6_.px;
                  _loc11_ = _loc6_;
               }
            }
         }
         else
         {
            _loc11_ = this.friendList[0];
         }
         if(this.cameraTime <= 0 && Boolean(_loc11_))
         {
            if(this.singlePlay)
            {
               camera.x += (_loc11_.px - camera.x) * 0.1;
               camera.y += (_loc11_.py - camera.y) * 0.1;
            }
         }
         else
         {
            --this.cameraTime;
         }
         _loc3_ = int(this.enemyList.length);
         if(_loc3_ > 1)
         {
            while(_loc3_-- > 1)
            {
               _loc6_ = this.enemyList[_loc3_];
               _loc4_ = int(_loc3_);
               while(_loc4_-- > 0)
               {
                  _loc7_ = this.enemyList[_loc4_];
                  if(_loc6_ != _loc7_)
                  {
                     _loc8_ = _loc6_.px - _loc7_.px;
                     _loc9_ = _loc6_.py - _loc7_.py;
                     _loc5_ = _loc8_ * _loc8_ + _loc9_ * _loc9_;
                     if(_loc5_ < 1600)
                     {
                        _loc5_ = Math.sqrt(_loc5_);
                        _loc8_ = _loc5_ == 0 ? 0 : _loc8_ / _loc5_;
                        _loc9_ = _loc5_ == 0 ? 0 : _loc9_ / _loc5_;
                        _loc6_.px += _loc8_ * (40 - _loc5_);
                        _loc6_.py += _loc9_ * (40 - _loc5_);
                     }
                  }
               }
            }
         }
         if(this.redBoss.nowHP <= 0 || this.blueBoss.nowHP <= 0)
         {
            if(this.gameOverTime > 0)
            {
               --this.gameOverTime;
               if(this.gameOverTime == 0)
               {
                  dispatchEvent(new DataEvent("win",true,false,this.redBoss.nowHP == 0 ? "right" : "left"));
                  stopEngine();
               }
            }
         }
         if(this.round > 0 && !this.stopTimer)
         {
            --this.round;
            if(this.round == 5 * 30)
            {
               this.SD_Timer.play();
            }
            if(this.round == 4 * 30)
            {
               this.SD_Timer.play();
            }
            if(this.round == 3 * 30)
            {
               this.SD_Timer.play();
            }
            if(this.round == 2 * 30)
            {
               this.SD_Timer.play();
            }
            if(this.round == 1 * 30)
            {
               this.SD_Timer.play();
            }
            if(this.round == 0)
            {
               this.leftPopulation = this.populationLimit;
               this.rightPopulation = this.populationLimit;
               this.leftMoney += this.leftIncome;
               this.rightMoney += this.rightIncome;
               this.round = 30 * 30;
               this.SD_cheer.play();
               if(this.singlePlay)
               {
                  this.ai();
               }
            }
            if(this.round % 3 == 0)
            {
               if(this.p1[2] == 1)
               {
                  this.createUnit(1,this.p1[0] + this.p1[1] * 8);
               }
               if(this.p2[2] == 1)
               {
                  this.createUnit(-1,this.p2[0] + this.p2[1] * 8);
               }
            }
         }
         if(this.ui)
         {
            if(Object(this.ui).p1.scaleX > 1)
            {
               Object(this.ui).p1.scaleX = Object(this.ui).p1.scaleY = Object(this.ui).p1.scaleY - 0.1;
               Object(this.ui).p1.alpha = Object(this.ui).p1.alpha - 0.05;
            }
            if(Object(this.ui).p2.scaleX > 1)
            {
               Object(this.ui).p2.scaleX = Object(this.ui).p2.scaleY = Object(this.ui).p2.scaleY - 0.1;
               Object(this.ui).p2.alpha = Object(this.ui).p2.alpha - 0.05;
            }
            Object(this.ui).p1.x = Object(this.ui)["a" + (this.p1[0] + this.p1[1] * 8)].x;
            Object(this.ui).p1.y = Object(this.ui)["a" + (this.p1[0] + this.p1[1] * 8)].y;
            Object(this.ui).p2.x = Object(this.ui)["b" + (this.p2[0] + this.p2[1] * 8)].x;
            Object(this.ui).p2.y = Object(this.ui)["b" + (this.p2[0] + this.p2[1] * 8)].y;
            _loc12_ = 0.06;
            _loc2_ = getTimer();
            Object(this.ui).time.text = int(this.round / 30);
            Object(this.ui).leftMoney.text = this.leftMoney;
            Object(this.ui).leftIncome.text = this.leftIncome;
            Object(this.ui).leftPopulation.text = this.leftPopulation;
            Object(this.ui).rightMoney.text = this.rightMoney;
            Object(this.ui).rightIncome.text = this.rightIncome;
            Object(this.ui).rightPopulation.text = this.rightPopulation;
            Object(this.ui).leftBar.bar.scaleX = this.redBoss.nowHP / this.redBoss.maxHP;
            Object(this.ui).rightBar.bar.scaleX = this.blueBoss.nowHP / this.blueBoss.maxHP;
            Object(this.ui).map.graphics.clear();
            Object(this.ui).map.graphics.beginFill(0,0.8);
            Object(this.ui).map.graphics.drawRect(0,0,this.mapWidth * _loc12_,this.mapHeight * _loc12_);
            Object(this.ui).map.graphics.endFill();
            _loc3_ = int(this.friendList.length);
            while(_loc3_-- > 0)
            {
               Object(this.ui).map.graphics.beginFill(16711680);
               Object(this.ui).map.graphics.drawCircle(this.friendList[_loc3_].px * _loc12_,this.friendList[_loc3_].py * _loc12_,1);
               Object(this.ui).map.graphics.endFill();
            }
            _loc3_ = int(this.enemyList.length);
            while(_loc3_-- > 0)
            {
               Object(this.ui).map.graphics.beginFill(255);
               Object(this.ui).map.graphics.drawCircle(this.enemyList[_loc3_].px * _loc12_,this.enemyList[_loc3_].py * _loc12_,1);
               Object(this.ui).map.graphics.endFill();
            }
            Object(this.ui).map.graphics.beginFill(0,0);
            Object(this.ui).map.graphics.lineStyle(1,16777215,0.4);
            Object(this.ui).map.graphics.drawRect((camera.x - camera.width / 2) * _loc12_,(camera.y - camera.height / 2) * _loc12_,camera.width * _loc12_,camera.height * _loc12_);
            Object(this.ui).map.graphics.endFill();
            if(this.mouseMapDown)
            {
               this.cameraTime = 60;
               camera.x = Object(this.ui).map.mouseX / _loc12_;
               camera.y = Object(this.ui).map.mouseY / _loc12_;
            }
         }
      }
   }
}

