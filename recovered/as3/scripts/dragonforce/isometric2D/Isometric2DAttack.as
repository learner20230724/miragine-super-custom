package dragonforce.isometric2D
{
   import dragonforce.core.Symbol;
   
   public class Isometric2DAttack extends Symbol
   {
      
      public static var BULLET:String = "bullet";
      
      public static var MELEE:String = "melee";
      
      public var vx:Number = 0;
      
      public var vy:Number = 0;
      
      public var vz:Number = 0;
      
      public var direction:Number = 1;
      
      public var opposite:int = -1;
      
      public var target:Isometric2DEntity;
      
      public var father:Isometric2DEntity;
      
      public var life:int = 100;
      
      public var delay:int = 0;
      
      public var damageType:String = BULLET;
      
      public function Isometric2DAttack(param1:Isometric2DEntity, param2:Isometric2DEntity, param3:int = 0)
      {
         super();
         this.father = param1;
         this.target = param2;
         this.delay = param3;
         px = param1.px;
         py = param1.py;
         pz = param1.pz;
         this.direction = param1.direction;
         visible = false;
      }
      
      override public function step() : void
      {
         super.step();
         if(this.delay == 0)
         {
            visible = true;
            px += this.vx;
            if(this.direction > 0 && px > this.target.px || this.direction < 0 && px < this.target.px)
            {
               px = this.target.px;
               if(Math.abs(py - this.target.py) <= 30)
               {
                  this.target.minusHP(this.father.damage);
               }
               parent.removeChild(this);
            }
         }
         else
         {
            --this.delay;
         }
         if(this.life == 0)
         {
            parent.removeChild(this);
         }
         else
         {
            --this.life;
         }
         sx = this.direction * this.opposite;
      }
   }
}

