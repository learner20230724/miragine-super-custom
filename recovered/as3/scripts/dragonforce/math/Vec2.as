package dragonforce.math
{
   public class Vec2
   {
      
      public var x:Number;
      
      public var y:Number;
      
      public function Vec2(param1:Number = 0, param2:Number = 0)
      {
         super();
         this.x = param1;
         this.y = param2;
      }
      
      public static function project(param1:Number, param2:Number) : Vec2
      {
         return new Vec2(Math.cos(param1) * param2,Math.sin(param1) * param2);
      }
      
      public function plus(param1:Vec2) : void
      {
         this.x += param1.x;
         this.y += param1.y;
      }
      
      public function minus(param1:Vec2) : void
      {
         this.x -= param1.x;
         this.y -= param1.y;
      }
      
      public function times(param1:Number) : void
      {
         this.x *= param1;
         this.y *= param1;
      }
      
      public function divided(param1:Number) : void
      {
         this.x /= param1;
         this.y /= param1;
      }
      
      public function normalize() : void
      {
         this.divided(this.length);
      }
      
      public function reverse() : void
      {
         this.x = -this.x;
         this.y = -this.y;
      }
      
      public function zero() : void
      {
         this.x = 0;
         this.y = 0;
      }
      
      public function rotation(param1:Number) : void
      {
         var _loc2_:Number = Math.cos(param1);
         var _loc3_:Number = Math.sin(param1);
         this.x = this.x * _loc2_ - this.y * _loc3_;
         this.y = this.x * _loc3_ + this.y * _loc2_;
      }
      
      public function getPlus(param1:Vec2) : Vec2
      {
         return new Vec2(this.x + param1.x,this.y + param1.y);
      }
      
      public function getMinus(param1:Vec2) : Vec2
      {
         return new Vec2(this.x - param1.x,this.y - param1.y);
      }
      
      public function getTimes(param1:Number) : Vec2
      {
         return new Vec2(this.x * param1,this.y * param1);
      }
      
      public function getDivided(param1:Number) : Vec2
      {
         return param1 == 0 ? new Vec2() : new Vec2(this.x / param1,this.y / param1);
      }
      
      public function dot(param1:Vec2) : Number
      {
         return this.x * param1.x + this.y * param1.y;
      }
      
      public function cross(param1:Vec2) : Number
      {
         return this.x * param1.y - this.y * param1.x;
      }
      
      public function getUnit() : Vec2
      {
         return this.getDivided(this.length);
      }
      
      public function getPerp() : Vec2
      {
         return new Vec2(-this.y,this.x);
      }
      
      public function getRotation(param1:Number) : Vec2
      {
         var _loc2_:Number = Math.cos(param1);
         var _loc3_:Number = Math.sin(param1);
         return new Vec2(this.x * _loc2_ - this.y * _loc3_,this.x * _loc3_ + this.y * _loc2_);
      }
      
      public function getAngle(param1:Vec2) : Number
      {
         return Math.atan2(param1.y - this.y,param1.x - this.x);
      }
      
      public function getDistance(param1:Vec2) : Number
      {
         return Math.sqrt((param1.x - this.x) * (param1.x - this.x) + (param1.y - this.y) * (param1.y - this.y));
      }
      
      public function clone() : Vec2
      {
         return new Vec2(this.x,this.y);
      }
      
      public function get length() : Number
      {
         return Math.sqrt(this.x * this.x + this.y * this.y);
      }
      
      public function toString() : String
      {
         return "(x=" + this.x + ", y=" + this.y + ")";
      }
   }
}

