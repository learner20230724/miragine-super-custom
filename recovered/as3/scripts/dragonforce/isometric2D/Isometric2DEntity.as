package dragonforce.isometric2D
{
   import dragonforce.core.SpriteSheet;
   import dragonforce.core.Symbol;
   import dragonforce.math.Vec2;
   import flash.events.Event;
   
   public dynamic class Isometric2DEntity extends Symbol
   {
      
      public static var WALK:String = "walk";
      
      public static var RUN:String = "run";
      
      public static var IDLE:String = "idle";
      
      public static var HURT:String = "dead";
      
      public static var DEAD:String = "dead";
      
      public static var ATTACK:String = "attack";
      
      public static var LIGHT:int = 0;
      
      public static var ARMORED:int = 1;
      
      public var vx:Number = 0;
      
      public var vy:Number = 0;
      
      public var vz:Number = 0;
      
      public var moveSpeed:Number = 0;
      
      public var weaponSpeed:Number = 0;
      
      public var damage:Array = [0,0];
      
      public var range:Number = 0;
      
      public var armor:Number = 0;
      
      public var armorTypeID:int = LIGHT;
      
      public var nowHP:Number = 100;
      
      public var maxHP:Number = 100;
      
      public var opposite:int = -1;
      
      public var direction:int = 1;
      
      public var data:*;
      
      public var targetList:Vector.<Isometric2DEntity> = new Vector.<Isometric2DEntity>();
      
      public var target:Isometric2DEntity;
      
      public var weaponSpriteSheet:SpriteSheet;
      
      public var delayAttack:int;
      
      private var gravity:Number = -0.8;
      
      private var t:int = 0;
      
      private var jumpTimes:int = 2;
      
      private var deadTime:int = 0;
      
      public function Isometric2DEntity()
      {
         super();
      }
      
      public function move(param1:Vec2) : void
      {
         var _loc2_:Vec2 = null;
         if(this.t == 0 || pz > 0)
         {
            _loc2_ = param1.getUnit();
            this.vx = _loc2_.x * this.moveSpeed;
            this.vy = _loc2_.y * this.moveSpeed;
            this.direction = this.vx > 0 ? 1 : -1;
         }
      }
      
      public function moveTo(param1:Vec2) : void
      {
         var _loc2_:Vec2 = null;
         if(this.t == 0 || pz > 0)
         {
            _loc2_ = new Vec2(param1.x - px,param1.y - py);
            if(_loc2_.x * _loc2_.x + _loc2_.y * _loc2_.y < this.moveSpeed * this.moveSpeed)
            {
               px = param1.x;
               py = param1.y;
            }
            else
            {
               _loc2_.normalize();
               this.vx = _loc2_.x * this.moveSpeed;
               this.vy = _loc2_.y * this.moveSpeed;
            }
            this.direction = this.vx > 0 ? 1 : -1;
         }
      }
      
      public function jump() : void
      {
         if(pz == 0 && this.t == 0)
         {
            pz = 1;
         }
         if(this.jumpTimes > 0)
         {
            this.vz = 10;
            --this.jumpTimes;
         }
      }
      
      public function hurt() : void
      {
         this.t = 10;
         gotoAndPlay(HURT);
      }
      
      public function dead() : void
      {
         this.t = 1000;
         this.nowHP = 0;
         gotoAndPlay(DEAD);
         this.deadTime = 25;
         dispatchEvent(new Event("destroy"));
         pz = 1;
         this.vx = -5 * this.direction;
         this.vz = 8;
      }
      
      public function attack() : void
      {
         var _loc1_:Isometric2DAttack = null;
         if(this.t == 0)
         {
            this.t = this.weaponSpeed;
            gotoAndPlay(ATTACK);
            _loc1_ = new Isometric2DAttack(this,this.target,this.delayAttack);
            _loc1_.spriteSheet = this.weaponSpriteSheet;
            if(this.weaponSpriteSheet)
            {
               _loc1_.gotoAndPlay("idle");
            }
            _loc1_.pz = 40;
            _loc1_.vx = 20 * this.direction;
            parent.addChild(_loc1_);
            dispatchEvent(new Event("attack"));
         }
      }
      
      public function minusHP(param1:Array) : void
      {
         if(this.nowHP > 0)
         {
            this.nowHP -= param1[this.armorTypeID] - this.armor;
            if(this.nowHP <= 0)
            {
               this.nowHP = 0;
               this.dead();
            }
         }
      }
      
      private function findTarget() : void
      {
         var _loc1_:Isometric2DEntity = null;
         var _loc4_:Number = NaN;
         var _loc5_:Number = NaN;
         var _loc6_:Number = NaN;
         this.target = null;
         var _loc2_:Number = Number.MAX_VALUE;
         var _loc3_:int = 0;
         while(_loc3_ < this.targetList.length)
         {
            _loc1_ = this.targetList[_loc3_];
            if(_loc1_.nowHP != 0)
            {
               _loc4_ = (_loc1_.px - px) * (_loc1_.px - px);
               _loc5_ = (_loc1_.py - py) * (_loc1_.py - py);
               _loc6_ = _loc4_ + 30 * _loc5_;
               if(_loc6_ < _loc2_)
               {
                  _loc2_ = _loc6_;
                  this.target = _loc1_;
               }
            }
            _loc3_++;
         }
      }
      
      private function approachTarget() : void
      {
         var _loc1_:Vec2 = new Vec2(this.target.px,this.target.py);
         _loc1_.x = this.target.px - px > 0 ? _loc1_.x - this.range : _loc1_.x + this.range;
         if(Math.abs(this.target.px - px) <= this.range && Math.abs(this.target.py - py) <= 40)
         {
            this.direction = this.target.px - px > 0 ? 1 : -1;
            this.attack();
         }
         else
         {
            this.moveTo(_loc1_);
         }
      }
      
      public function ai() : void
      {
         if(this.nowHP > 0)
         {
            this.findTarget();
            if(this.target != null)
            {
               this.approachTarget();
            }
         }
      }
      
      override public function step() : void
      {
         super.step();
         this.ai();
         if(this.t == 0)
         {
            px += this.vx;
            py += this.vy;
            if(pz == 0 && this.vx == 0 && this.vy == 0)
            {
               gotoAndPlay(IDLE);
            }
            else
            {
               gotoAndPlay(RUN);
            }
         }
         else
         {
            if(pz > 0)
            {
               px += this.vx;
               py += this.vy;
            }
            --this.t;
         }
         if(pz > 0)
         {
            this.vz += this.gravity;
            pz += this.vz;
            if(pz <= 0)
            {
               pz = 0;
               this.vx = 0;
               this.vy = 0;
               this.vz = 0;
               this.jumpTimes = 2;
            }
         }
         else
         {
            this.vx = 0;
            this.vy = 0;
            this.vz = 0;
         }
         if(this.deadTime > 0)
         {
            --this.deadTime;
            if(this.deadTime == 1)
            {
               parent.removeChild(this);
            }
         }
         sx = this.direction * this.opposite;
      }
      
      public function get position() : Vec2
      {
         return new Vec2(px,py);
      }
   }
}

