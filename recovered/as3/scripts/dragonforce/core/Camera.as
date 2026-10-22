package dragonforce.core
{
   public class Camera
   {
      
      private var _x:Number;
      
      private var _y:Number;
      
      public var width:Number;
      
      public var height:Number;
      
      private var minX:Number;
      
      private var minY:Number;
      
      private var maxX:Number;
      
      private var maxY:Number;
      
      public function Camera(param1:Number = 0, param2:Number = 0, param3:Number = 640, param4:Number = 400)
      {
         super();
         this._x = param1;
         this._y = param2;
         this.width = param3;
         this.height = param4;
      }
      
      public function limitInMap(param1:int, param2:int) : void
      {
         this.minX = 0;
         this.minY = 0;
         this.maxX = param1 - this.width;
         this.maxY = param2 - this.height;
      }
      
      public function set x(param1:Number) : void
      {
         this._x = param1;
         if(this._x < this.minX)
         {
            this._x = this.minX;
         }
         if(this._x > this.maxX)
         {
            this._x = this.maxX;
         }
      }
      
      public function get x() : Number
      {
         return this._x;
      }
      
      public function set y(param1:Number) : void
      {
         this._y = param1;
         if(this._y < this.minY)
         {
            this._y = this.minY;
         }
         if(this._y > this.maxY)
         {
            this._y = this.maxY;
         }
      }
      
      public function get y() : Number
      {
         return this._y;
      }
      
      public function toString() : String
      {
         return "camera(x=" + this._x + ", y=" + this._y + ")";
      }
   }
}

